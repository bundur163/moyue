'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moyueDesktop', Object.freeze({
  platform: process.platform,
  print: () => ipcRenderer.invoke('moyue:print')
}));
