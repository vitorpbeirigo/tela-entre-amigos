const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("telaDesktop", {
  getSources: () => ipcRenderer.invoke("capture:get-sources"),
  selectSource: (sourceId, withSystemAudio) =>
    ipcRenderer.invoke("capture:select-source", { sourceId, withSystemAudio }),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  copyText: (value) => ipcRenderer.invoke("clipboard:write-text", value),
});
