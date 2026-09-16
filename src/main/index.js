const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { loadOAuthConfig, oauthConfigPaths } = require("./config");
const { OAuthManager } = require("./oauth");
const { DriveClient } = require("./drive");
const { DownloadManager } = require("./downloads");

let mainWindow;
let oauth;
let drive;
let downloads;
let lastInspection = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#080808",
    title: "Google Drive Utils",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.once("ready-to-show", () => mainWindow.show());
}

function registerIpc() {
  ipcMain.handle("auth:status", () => oauth.status());
  ipcMain.handle("auth:sign-in", () => oauth.signIn());
  ipcMain.handle("auth:sign-out", () => oauth.signOut());

  ipcMain.handle("folder:inspect", async (_event, folderUrl) => {
    const controller = new AbortController();
    const inspection = await drive.inspect(folderUrl, controller.signal, (progress) => {
      mainWindow?.webContents.send("download:progress", progress);
    });
    lastInspection = { folderUrl, ...inspection };
    return inspection.summary;
  });

  ipcMain.handle("download:choose-destination", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose where to save your downloads",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? "" : result.filePaths[0];
  });

  ipcMain.handle("download:start", async (_event, options) => {
    if (!lastInspection || lastInspection.folderUrl !== options.folderUrl) {
      throw new Error("Scan the folder again before downloading.");
    }
    return downloads.start({
      tree: lastInspection.tree,
      destination: options.destination,
      mode: options.mode,
    });
  });
  ipcMain.handle("download:retry", () => downloads.retry());
  ipcMain.handle("download:cancel", () => downloads.cancel());
}

app.whenReady().then(async () => {
  const getConfig = () =>
    loadOAuthConfig(oauthConfigPaths({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath }));
  oauth = new OAuthManager({ app, safeStorage, shell, getConfig });
  await oauth.initialize();
  drive = new DriveClient(() => oauth.getAccessToken());
  downloads = new DownloadManager(drive, (progress) => {
    mainWindow?.webContents.send("download:progress", progress);
  });
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
