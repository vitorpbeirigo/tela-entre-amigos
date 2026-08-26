const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("telaDesktop", {
  getSources: () => ipcRenderer.invoke("capture:get-sources"),
  selectSource: (sourceId, withSystemAudio) =>
    ipcRenderer.invoke("capture:select-source", { sourceId, withSystemAudio }),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getPlatform: () => ipcRenderer.invoke("app:get-platform"),
  getCapturePermission: () => ipcRenderer.invoke("capture:get-permission"),
  openCaptureSettings: () => ipcRenderer.invoke("capture:open-settings"),
  copyText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
  getTurnServers: () => ipcRenderer.invoke("network:get-turn-servers"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
