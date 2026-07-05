const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPlayerChrome', {
  control: (command, value) => ipcRenderer.invoke('desktop-player:control', { command, value }),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-player:state', listener);
    return () => ipcRenderer.removeListener('desktop-player:state', listener);
  }
});
