const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, session } = require("electron");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let selectedSourceId = null;
let captureSystemAudio = true;

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true,
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon?.toDataURL() ?? null,
    type: source.id.startsWith("screen:") ? "screen" : "window",
  }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#08090a",
    title: "Tela",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isMainWindow = webContents === mainWindow?.webContents;
    const isExpectedPermission = ["media", "display-capture", "fullscreen"].includes(permission);
    callback(isMainWindow && isExpectedPermission);
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const source = sources.find((item) => item.id === selectedSourceId);

      if (!source) {
        callback({});
        return;
      }

      callback({
        video: source,
        audio: captureSystemAudio ? "loopback" : undefined,
      });
    } catch (error) {
      console.error("Falha ao selecionar captura", error);
      callback({});
    }
  });

  ipcMain.handle("capture:get-sources", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return listCaptureSources();
  });
  ipcMain.handle("capture:select-source", (event, options) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (typeof options?.sourceId !== "string" || typeof options?.withSystemAudio !== "boolean") {
      throw new TypeError("Opções de captura inválidas");
    }
    selectedSourceId = options.sourceId;
    captureSystemAudio = options.withSystemAudio;
    return true;
  });
  ipcMain.handle("app:get-version", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return app.getVersion();
  });
  ipcMain.handle("clipboard:write-text", async (event, value) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (typeof value !== "string" || value.length > 200) throw new TypeError("Texto inválido");
    await clipboard.writeText(value);
    return await clipboard.readText() === value;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
