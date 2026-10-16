const { contextBridge, ipcRenderer } = require("electron");

// The portal looks for window.misfitDesktop to know it's running in the app.
contextBridge.exposeInMainWorld("misfitDesktop", {
  notify: (alert) => ipcRenderer.send("notify", alert),
});
