const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('notesAPI', {
  list: () => ipcRenderer.invoke('notes:list'),
  read: (name) => ipcRenderer.invoke('notes:read', name),
  save: (name, content) => ipcRenderer.invoke('notes:save', { name, content }),
  remove: (name) => ipcRenderer.invoke('notes:delete', name),
  setImportance: (name, importance) => ipcRenderer.invoke('notes:setImportance', { name, importance }),
  flushSync: (name, content) => ipcRenderer.sendSync('notes:flush', { name, content })
});
