const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  licRead: () => ipcRenderer.invoke('lic:read'),
  licWrite: s => ipcRenderer.invoke('lic:write', s),
  dbLoad: () => ipcRenderer.invoke('db:load'),
  dbSave: s => ipcRenderer.invoke('db:save', s),
  dbSaveSync: s => ipcRenderer.sendSync('db:saveSync', s),
  dbWipe: () => ipcRenderer.invoke('db:wipe'),
  info: () => ipcRenderer.invoke('app:info'),
  win: a => ipcRenderer.send('win:ctl', a)
});
