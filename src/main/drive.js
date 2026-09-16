const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_MIME_PREFIX = "application/vnd.google-apps.";

function parseFolderUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Google Drive folder link.");
  }
  if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) {
    throw new Error("Enter a Google Drive folder link.");
  }
  const match = url.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("This link does not contain a Google Drive folder ID.");
  return { id: match[1], resourceKey: url.searchParams.get("resourcekey") || "" };
}

function sanitizeName(name) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return reserved.test(cleaned) ? `_${cleaned}` : cleaned || "Untitled";
}

function assignUniqueNames(items) {
  const used = new Set();
  return items.map((item) => {
    const base = sanitizeName(item.name);
    let candidate = base;
    let counter = 2;
    const extensionIndex = base.lastIndexOf(".");
    const stem = extensionIndex > 0 ? base.slice(0, extensionIndex) : base;
    const extension = extensionIndex > 0 ? base.slice(extensionIndex) : "";
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem} (${counter})${extension}`;
      counter += 1;
    }
    used.add(candidate.toLowerCase());
    return { ...item, safeName: candidate };
  });
}

class DriveClient {
  constructor(getAccessToken) {
    this.getAccessToken = getAccessToken;
  }

  async request(url, { signal, resourceKeys = "" } = {}) {
    const token = await this.getAccessToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (resourceKeys) headers["X-Goog-Drive-Resource-Keys"] = resourceKeys;
    const response = await fetch(url, { headers, signal });
    if (!response.ok) {
      let message = `Google Drive returned ${response.status}.`;
      try {
        const body = await response.json();
        message = body.error?.message || message;
      } catch {}
      if (response.status === 403 || response.status === 404) {
        message = "This folder is unavailable. Check the link and your Google account access.";
      }
      throw new Error(message);
    }
    return response;
  }

  async getFile(id, resourceKey, signal) {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,size,resourceKey,capabilities(canDownload)",
      supportsAllDrives: "true",
    });
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${id}?${params}`, {
      signal,
      resourceKeys: resourceKey ? `${id}/${resourceKey}` : "",
    });
    return response.json();
  }

  async listChildren(parentId, resourceKey, signal) {
    const all = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,resourceKey,capabilities(canDownload),shortcutDetails(targetId,targetMimeType))",
        pageSize: "1000",
        orderBy: "folder,name_natural",
        spaces: "drive",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request(`https://www.googleapis.com/drive/v3/files?${params}`, {
        signal,
        resourceKeys: resourceKey ? `${parentId}/${resourceKey}` : "",
      });
      const data = await response.json();
      all.push(...(data.files || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return assignUniqueNames(all);
  }

  async inspect(folderUrl, signal, onProgress = () => {}) {
    const parsed = parseFolderUrl(folderUrl);
    const root = await this.getFile(parsed.id, parsed.resourceKey, signal);
    if (root.mimeType !== FOLDER_MIME) throw new Error("The link must point to a folder.");
    root.resourceKey = root.resourceKey || parsed.resourceKey;
    root.safeName = sanitizeName(root.name);

    let folderCount = 0;
    let fileCount = 0;
    let unsupportedCount = 0;
    let knownBytes = 0;

    const visit = async (folder) => {
      folderCount += 1;
      onProgress({ phase: "scanning", message: `Scanning ${folder.name}…`, folderCount, fileCount });
      const children = await this.listChildren(folder.id, folder.resourceKey, signal);
      folder.folders = [];
      folder.files = [];
      folder.unsupported = [];
      for (const child of children) {
        if (child.mimeType === FOLDER_MIME) {
          folder.folders.push(child);
          await visit(child);
        } else if (
          child.mimeType.startsWith(GOOGLE_MIME_PREFIX) ||
          child.capabilities?.canDownload === false
        ) {
          folder.unsupported.push(child);
          unsupportedCount += 1;
        } else {
          folder.files.push(child);
          fileCount += 1;
          knownBytes += Number(child.size || 0);
        }
      }
    };
    await visit(root);

    return {
      tree: root,
      summary: {
        name: root.name,
        folderCount: Math.max(0, folderCount - 1),
        fileCount,
        unsupportedCount,
        knownBytes,
        hasSubfolders: root.folders.length > 0,
        rootFileCount: root.files.length,
      },
    };
  }

  async downloadResponse(file, signal) {
    const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
    return this.request(`https://www.googleapis.com/drive/v3/files/${file.id}?${params}`, {
      signal,
      resourceKeys: file.resourceKey ? `${file.id}/${file.resourceKey}` : "",
    });
  }
}

function flattenFiles(folder, prefix = "") {
  const entries = folder.files.map((file) => ({ file, relativePath: `${prefix}${file.safeName}` }));
  for (const child of folder.folders) {
    entries.push(...flattenFiles(child, `${prefix}${child.safeName}/`));
  }
  return entries;
}

function flattenDirectories(folder, prefix = "") {
  const entries = [];
  for (const child of folder.folders) {
    const relativePath = `${prefix}${child.safeName}/`;
    entries.push(relativePath, ...flattenDirectories(child, relativePath));
  }
  return entries;
}

module.exports = {
  DriveClient,
  FOLDER_MIME,
  assignUniqueNames,
  flattenDirectories,
  flattenFiles,
  parseFolderUrl,
  sanitizeName,
};
