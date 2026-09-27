const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 笔记统一存放目录（相对于项目根目录）
const NOTES_DIR = path.join(__dirname, 'notes');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // 确保笔记目录存在
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 列出所有 .md 笔记
ipcMain.handle('notes:list', () => {
  return fs.readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
});

// 读取笔记内容
ipcMain.handle('notes:read', (_e, name) => {
  const filePath = path.join(NOTES_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
});

// 保存笔记
ipcMain.handle('notes:save', (_e, { name, content }) => {
  const safeName = String(name).trim();
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return safeName;
});
