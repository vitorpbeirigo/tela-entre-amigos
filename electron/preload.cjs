const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("telaDesktop", {
  getSources: () => ipcRenderer.invoke("capture:get-sources"),
  selectSource: (sourceId) => ipcRenderer.invoke("capture:select-source", { sourceId }),
  startDiscordFilteredAudio: () => ipcRenderer.invoke("audio:start-discord-filtered"),
  stopDiscordFilteredAudio: () => ipcRenderer.invoke("audio:stop-discord-filtered"),
  onAudioPcm: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("audio:pcm", listener);
    return () => ipcRenderer.removeListener("audio:pcm", listener);
  },
  onAudioStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("audio:status", listener);
    return () => ipcRenderer.removeListener("audio:status", listener);
  },
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getPlatform: () => ipcRenderer.invoke("app:get-platform"),
  getCapturePermission: () => ipcRenderer.invoke("capture:get-permission"),
  requestCapturePermission: () => ipcRenderer.invoke("capture:request-permission"),
  openCaptureSettings: () => ipcRenderer.invoke("capture:open-settings"),
  getConnectionPermission: () => ipcRenderer.invoke("connection:get-permission"),
  requestConnectionPermission: () => ipcRenderer.invoke("connection:request-permission"),
  openConnectionSettings: () => ipcRenderer.invoke("connection:open-settings"),
  copyText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
  getTurnServers: () => ipcRenderer.invoke("network:get-turn-servers"),
  logEvent: (name, details) => ipcRenderer.send("diagnostics:event", name, details),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
