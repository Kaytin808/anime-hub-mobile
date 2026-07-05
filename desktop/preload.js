const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPlayer', {
  play: (payload) => ipcRenderer.invoke('desktop-player:play', payload),
  control: (payload) => ipcRenderer.invoke('desktop-player:control', payload),
  getCapabilities: () => ipcRenderer.invoke('desktop-player:capabilities'),
  log: (message, details) => ipcRenderer.invoke('desktop-player:log', { message, details }),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-player:state', listener);
    return () => ipcRenderer.removeListener('desktop-player:state', listener);
  }
});
