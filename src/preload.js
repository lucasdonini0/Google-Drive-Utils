const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("driveUtils", {
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  signIn: () => ipcRenderer.invoke("auth:sign-in"),
  signOut: () => ipcRenderer.invoke("auth:sign-out"),
  inspectFolder: (folderUrl) => ipcRenderer.invoke("folder:inspect", folderUrl),
  chooseDestination: () => ipcRenderer.invoke("download:choose-destination"),
  startDownload: (options) => ipcRenderer.invoke("download:start", options),
  retryDownload: () => ipcRenderer.invoke("download:retry"),
  cancelDownload: () => ipcRenderer.invoke("download:cancel"),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("download:progress", listener);
    return () => ipcRenderer.removeListener("download:progress", listener);
  },
});
