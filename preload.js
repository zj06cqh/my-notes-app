const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('notesAPI', {
  list: () => ipcRenderer.invoke('notes:list'),
  read: (name) => ipcRenderer.invoke('notes:read', name),
  save: (name, content) => ipcRenderer.invoke('notes:save', { name, content })
});
