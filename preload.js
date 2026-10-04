const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('notesAPI', {
  list: () => ipcRenderer.invoke('notes:list'),
  read: (name) => ipcRenderer.invoke('notes:read', name),
  save: (name, content) => ipcRenderer.invoke('notes:save', { name, content }),
  remove: (name) => ipcRenderer.invoke('notes:delete', name),
  setImportance: (name, importance) => ipcRenderer.invoke('notes:setImportance', { name, importance }),
  flushSync: (name, content) => ipcRenderer.sendSync('notes:flush', { name, content }),
  ocrImage: (dataUrl) => ipcRenderer.invoke('ocr:image', dataUrl),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:image'),
  onOcrProgress: (cb) => ipcRenderer.on('ocr:progress', (_e, payload) => cb(payload)),
  onOpenNote: (cb) => ipcRenderer.on('note:open', (_e, name) => cb(name))
});

// 桌面宠物泡泡的拖动接口（通过 IPC 通知主进程移动窗口）
contextBridge.exposeInMainWorld('petAPI', {
  dragStart: (screenX, screenY) => ipcRenderer.send('pet:drag-start', { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send('pet:drag-move', { screenX, screenY }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  setContentBox: (box) => ipcRenderer.send('pet:set-content-box', box),
  getBubbles: () => ipcRenderer.invoke('pet:get-bubbles'),
  addBubble: (bubble) => ipcRenderer.invoke('pet:add-bubble', bubble),
  onBubblesChanged: (cb) => ipcRenderer.on('pet:bubbles-changed', (_e, list) => cb(list)),
  onPetStopped: (cb) => ipcRenderer.on('pet:stopped', () => cb()),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  openNote: (note) => ipcRenderer.send('pet:open-note', note)
});
