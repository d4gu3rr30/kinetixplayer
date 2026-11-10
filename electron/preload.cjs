const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kinetixWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximized: callback => {
    const listener = (_event, value) => callback(Boolean(value))
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
})

contextBridge.exposeInMainWorld('kinetixApp', {
  autoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
  setAutoLaunch: enabled => ipcRenderer.invoke('app:set-auto-launch', Boolean(enabled)),
})
