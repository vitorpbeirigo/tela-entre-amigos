const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, session, shell, systemPreferences } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow;
let selectedSourceId = null;
let audioCaptureProcess = null;
let turnCache = { expiresAt: 0, servers: [] };
let logFilePath = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function logEvent(event, details = {}) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details });
  console.log(record);
  if (logFilePath) fs.appendFile(logFilePath, `${record}\n`, () => undefined);
}

function initializeLogging() {
  const logsDirectory = app.getPath("logs");
  fs.mkdirSync(logsDirectory, { recursive: true });
  logFilePath = path.join(logsDirectory, "tela.log");
  logEvent("app-ready", {
    version: app.getVersion(),
    pid: process.pid,
    platform: process.platform,
  });
  const gpuStatusTimer = setTimeout(() => {
    logEvent("gpu-status", { gpu: app.getGPUFeatureStatus() });
  }, 3_000);
  gpuStatusTimer.unref();
}

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

function getAudioCaptureExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "TelaAudioCapture.exe")
    : path.join(__dirname, "..", "native", "bin", "TelaAudioCapture.exe");
}

function stopDiscordFilteredAudio() {
  const child = audioCaptureProcess;
  audioCaptureProcess = null;
  if (!child || child.exitCode !== null) return;

  logEvent("audio-helper-stop", { pid: child.pid });
  child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) {
      logEvent("audio-helper-force-stop", { pid: child.pid });
      child.kill("SIGKILL");
    }
  }, 1_000);
  forceKill.unref();
  child.once("exit", () => clearTimeout(forceKill));
}

function startDiscordFilteredAudio() {
  if (process.platform !== "win32") {
    throw new Error("A captura que exclui o Discord está disponível apenas no Windows.");
  }

  stopDiscordFilteredAudio();
  const executable = getAudioCaptureExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error("O componente de áudio do Tela não foi encontrado. Reinstale a versão mais recente.");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [String(process.pid)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    audioCaptureProcess = child;
    logEvent("audio-helper-start", { pid: child.pid, parentPid: process.pid });
    let ready = false;
    let stderrBuffer = "";

    const startupTimeout = setTimeout(() => {
      if (ready) return;
      stopDiscordFilteredAudio();
      reject(new Error("O capturador de áudio do Windows não respondeu."));
    }, 6_000);

    child.stdout.on("data", (chunk) => {
      if (child !== audioCaptureProcess || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("audio:pcm", new Uint8Array(chunk));
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const readyMatch = /^READY\s+(\d+)$/.exec(line.trim());
        if (readyMatch) {
          const discordPid = Number(readyMatch[1]);
          if (!ready) {
            ready = true;
            clearTimeout(startupTimeout);
            resolve({ discordExcluded: discordPid > 0 });
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("audio:status", {
              state: "ready",
              discordExcluded: discordPid > 0,
            });
          }
        } else if (line.trim()) {
          console.warn("Capturador de áudio:", line.trim());
        }
      }
    });

    child.once("error", (error) => {
      clearTimeout(startupTimeout);
      if (child === audioCaptureProcess) audioCaptureProcess = null;
      logEvent("audio-helper-error", { pid: child.pid, message: error.message });
      if (!ready) reject(new Error(`Não foi possível abrir o áudio seletivo: ${error.message}`));
    });

    child.once("exit", (code) => {
      clearTimeout(startupTimeout);
      if (child === audioCaptureProcess) audioCaptureProcess = null;
      logEvent("audio-helper-exit", { pid: child.pid, code });
      if (!ready) {
        reject(new Error(`O áudio seletivo foi encerrado antes de iniciar (código ${code ?? "desconhecido"}).`));
      } else if (code && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("audio:status", { state: "error" });
      }
    });
  });
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
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logEvent("renderer-gone", { reason: details.reason, exitCode: details.exitCode });
    stopDiscordFilteredAudio();
  });

  mainWindow.on("close", stopDiscordFilteredAudio);
  mainWindow.on("closed", () => {
    stopDiscordFilteredAudio();
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  initializeLogging();
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
        audio: process.platform === "darwin" ? "loopback" : undefined,
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
    if (typeof options?.sourceId !== "string") {
      throw new TypeError("Opções de captura inválidas");
    }
    selectedSourceId = options.sourceId;
    return true;
  });
  ipcMain.handle("audio:start-discord-filtered", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    return startDiscordFilteredAudio();
  });
  ipcMain.handle("audio:stop-discord-filtered", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Origem IPC não autorizada");
    stopDiscordFilteredAudio();
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
  ipcMain.on("diagnostics:event", (event, name, details) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (typeof name !== "string" || name.length > 80) return;
    const safeDetails = details && typeof details === "object" ? details : {};
    logEvent(`renderer:${name}`, safeDetails);
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

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    logEvent("second-instance-blocked");
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.on("window-all-closed", () => {
  stopDiscordFilteredAudio();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopDiscordFilteredAudio);
