const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const archiver = require("archiver");
const { flattenDirectories, flattenFiles, sanitizeName } = require("./drive");

async function availablePath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 2;
  while (true) {
    try {
      await fsp.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

class DownloadManager {
  constructor(drive, emit) {
    this.drive = drive;
    this.emit = emit;
    this.controller = null;
    this.active = false;
    this.failedJobs = [];
    this.completed = [];
  }

  cancel() {
    this.controller?.abort();
  }

  async start({ tree, destination, mode }) {
    if (this.active) throw new Error("A download is already running.");
    const jobs = await this.createJobs(tree, destination, mode);
    this.completed = [];
    this.failedJobs = [];
    return this.runJobs(jobs, []);
  }

  async retry() {
    if (this.active) throw new Error("A download is already running.");
    if (!this.failedJobs.length) throw new Error("There are no failed downloads to retry.");
    return this.runJobs([...this.failedJobs], [...this.completed]);
  }

  async runJobs(jobs, completed) {
    this.active = true;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const failures = [];
    const failedJobs = [];

    try {
      const totalBytes = jobs.reduce((sum, job) => sum + job.files.reduce((n, entry) => n + Number(entry.file.size || 0), 0), 0);
      let completedBytes = 0;

      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        this.emit({
          phase: "downloading",
          message: `Downloading ${job.label}…`,
          item: job.label,
          jobIndex: index + 1,
          jobCount: jobs.length,
          completedBytes,
          totalBytes,
        });
        try {
          const result = job.type === "zip"
            ? await this.writeZip(job, signal, (bytes, current) => {
                this.emit({ phase: "downloading", item: current, jobIndex: index + 1, jobCount: jobs.length, completedBytes: completedBytes + bytes, totalBytes });
              })
            : await this.writeFiles(job, signal, (bytes, current) => {
                this.emit({ phase: "downloading", item: current, jobIndex: index + 1, jobCount: jobs.length, completedBytes: completedBytes + bytes, totalBytes });
              });
          completedBytes += job.files.reduce((sum, entry) => sum + Number(entry.file.size || 0), 0);
          completed.push(result);
        } catch (error) {
          if (signal.aborted) throw error;
          failures.push({ label: job.label, message: error.message });
          failedJobs.push(job);
        }
      }

      this.completed = completed;
      this.failedJobs = failedJobs;
      const result = { completed, failures, cancelled: false };
      this.emit({ phase: failures.length ? "partial" : "complete", ...result });
      return result;
    } catch (error) {
      if (signal.aborted) {
        this.completed = completed;
        const result = { completed, failures, cancelled: true };
        this.emit({ phase: "cancelled", ...result });
        return result;
      }
      throw error;
    } finally {
      this.active = false;
      this.controller = null;
    }
  }

  async createJobs(tree, destination, mode) {
    if (mode === "single-zip") {
      const output = await availablePath(path.join(destination, `${sanitizeName(tree.name)}.zip`));
      return [{
        type: "zip",
        label: path.basename(output),
        output,
        files: flattenFiles(tree, `${tree.safeName}/`),
        directories: [`${tree.safeName}/`, ...flattenDirectories(tree, `${tree.safeName}/`)],
      }];
    }
    if (mode === "individual") {
      const output = await availablePath(path.join(destination, tree.safeName));
      return [{ type: "files", label: tree.name, output, files: flattenFiles(tree), directories: flattenDirectories(tree) }];
    }
    if (mode === "per-folder") {
      const jobs = [];
      for (const folder of tree.folders) {
        const output = await availablePath(path.join(destination, `${folder.safeName}.zip`));
        jobs.push({ type: "zip", label: path.basename(output), output, files: flattenFiles(folder), directories: flattenDirectories(folder) });
      }
      if (tree.files.length) {
        const output = await availablePath(path.join(destination, `${tree.safeName} - files.zip`));
        jobs.push({ type: "zip", label: path.basename(output), output, files: tree.files.map((file) => ({ file, relativePath: file.safeName })), directories: [] });
      }
      return jobs;
    }
    throw new Error("Choose a download mode.");
  }

  async writeZip(job, signal, report) {
    const tempPath = `${job.output}.part`;
    await fsp.mkdir(path.dirname(job.output), { recursive: true });
    const output = fs.createWriteStream(tempPath, { flags: "wx" });
    const archive = archiver("zip", { zlib: { level: 6 }, forceZip64: true });
    const finished = new Promise((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);
    let bytes = 0;
    try {
      for (const directory of job.directories || []) archive.append("", { name: directory });
      for (const entry of job.files) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const response = await this.drive.downloadResponse(entry.file, signal);
        const stream = Readable.fromWeb(response.body);
        stream.on("data", (chunk) => {
          bytes += chunk.length;
          report(bytes, entry.relativePath);
        });
        archive.append(stream, { name: entry.relativePath });
      }
      await archive.finalize();
      await finished;
      await fsp.rename(tempPath, job.output);
      return job.output;
    } catch (error) {
      archive.abort();
      output.destroy();
      await fsp.rm(tempPath, { force: true });
      throw error;
    }
  }

  async writeFiles(job, signal, report) {
    await fsp.mkdir(job.output, { recursive: true });
    for (const directory of job.directories || []) {
      await fsp.mkdir(path.join(job.output, ...directory.split("/").filter(Boolean)), { recursive: true });
    }
    let bytes = 0;
    try {
      for (const entry of job.files) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const target = path.join(job.output, ...entry.relativePath.split("/"));
        const tempPath = `${target}.part`;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        try {
          await fsp.access(target);
          bytes += Number(entry.file.size || 0);
          report(bytes, entry.relativePath);
          continue;
        } catch {}
        const response = await this.drive.downloadResponse(entry.file, signal);
        const source = Readable.fromWeb(response.body);
        source.on("data", (chunk) => {
          bytes += chunk.length;
          report(bytes, entry.relativePath);
        });
        try {
          await pipeline(source, fs.createWriteStream(tempPath, { flags: "wx" }), { signal });
          await fsp.rename(tempPath, target);
        } catch (error) {
          await fsp.rm(tempPath, { force: true });
          throw error;
        }
      }
      return job.output;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = { DownloadManager, availablePath };
