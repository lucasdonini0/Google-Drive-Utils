const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DownloadManager } = require("../src/main/downloads");

test("retry only downloads the failed individual files", async () => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "gdu-download-"));
  const attempts = new Map();
  const drive = {
    async downloadResponse(file) {
      const count = (attempts.get(file.id) || 0) + 1;
      attempts.set(file.id, count);
      if (file.id === "b" && count === 1) throw new Error("Temporary connection failure");
      return new Response(Buffer.from(file.id));
    },
  };
  const tree = {
    name: "Folder",
    safeName: "Folder",
    folders: [],
    files: [
      { id: "a", name: "a.txt", safeName: "a.txt", size: "1" },
      { id: "b", name: "b.txt", safeName: "b.txt", size: "1" },
    ],
  };
  const manager = new DownloadManager(drive, () => {});

  try {
    const first = await manager.start({ tree, destination, mode: "individual" });
    assert.equal(first.failures.length, 1);
    assert.equal(await fs.readFile(path.join(destination, "Folder", "a.txt"), "utf8"), "a");

    const retried = await manager.retry();
    assert.equal(retried.failures.length, 0);
    assert.equal(await fs.readFile(path.join(destination, "Folder", "b.txt"), "utf8"), "b");
    assert.equal(attempts.get("a"), 1);
    assert.equal(attempts.get("b"), 2);
  } finally {
    await fs.rm(destination, { recursive: true, force: true });
  }
});
