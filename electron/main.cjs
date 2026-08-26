const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, session, shell, systemPreferences } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let selectedSourceId = null;
let captureSystemAudio = true;
let turnCache = { expiresAt: 0, servers: [] };

const NETWORK_CONFIG_URL =
  "https://raw.githubusercontent.com/vitorpbeirigo/tela-entre-amigos/main/network.json";

async function fetchJson(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": `Tela/${app.getVersion()}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTurnServers(payload) {
  const candidates = Array.isArray(payload) ? payload : payload?.iceServers;
  if (!Array.isArray(candidates)) return [];

  return candidates.slice(0, 12).flatMap((candidate) => {
    const urls = typeof candidate?.urls === "string"
      ? [candidate.urls]
      : Array.isArray(candidate?.urls)
        ? candidate.urls
        : [];
    const safeUrls = urls.filter((url) => typeof url === "string" && /^turns?:/i.test(url));
    if (!safeUrls.length || typeof candidate?.username !== "string" || typeof candidate?.credential !== "string") {
      return [];
    }
    if (candidate.username.length > 512 || candidate.credential.length > 1024) return [];
    return [{
      urls: safeUrls.length === 1 ? safeUrls[0] : safeUrls,
      username: candidate.username,
      credential: candidate.credential,
    }];
  });
}

async function getTurnServers() {
  if (turnCache.expiresAt > Date.now()) return turnCache.servers;

  try {
    const manifest = await fetchJson(NETWORK_CONFIG_URL);
    const credentialsUrl = manifest?.turnCredentialsUrl;
    if (typeof credentialsUrl !== "string" || !credentialsUrl.startsWith("https://")) return [];
    const servers = normalizeTurnServers(await fetchJson(credentialsUrl));
    turnCache = { expiresAt: Date.now() + 5 * 60_000, servers };
    return servers;
  } catch (error) {
    console.warn("TURN indisponível; usando conexão direta", error);
    return [];
  }
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update:status", status);
}

function configureAutoUpdater() {
  if (!app.isPackaged || process.platform === "darwin") return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ state: "current" }));
  autoUpdater.on("download-progress", (progress) => sendUpdateStatus({
    state: "downloading",
    percent: Math.round(progress.percent),
  }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => {
    console.warn("Atualização automática indisponível", error);
    sendUpdateStatus({ state: "error" });
  });

  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => void autoUpdater.checkForUpdates(), 4_000);
  });
}

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
  ipcMain.handle("app:get-platform", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return process.platform;
  });
  ipcMain.handle("capture:get-permission", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
  });
  ipcMain.handle("capture:open-settings", async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (process.platform !== "darwin") return false;
    await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    return true;
  });
  ipcMain.handle("clipboard:write-text", async (event, value) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (typeof value !== "string" || value.length > 200) throw new TypeError("Texto inválido");
    await clipboard.writeText(value);
    return await clipboard.readText() === value;
  });
  ipcMain.handle("network:get-turn-servers", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return getTurnServers();
  });
  ipcMain.handle("update:check", async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (!app.isPackaged) return { state: "development" };
    if (process.platform === "darwin") return { state: "manual" };
    await autoUpdater.checkForUpdates();
    return { state: "checking" };
  });
  ipcMain.handle("update:install", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    if (!app.isPackaged || process.platform === "darwin") return false;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  createWindow();
  configureAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
