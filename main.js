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

// ---- frontmatter 元数据解析/写入 ----

// 复习元数据默认值
const DEFAULT_META = {
  importance: 0,    // 0 = 未设置，1-5 = 重要程度
  lastReview: '',   // 上次复习日期 YYYY-MM-DD
  nextReview: '',   // 下次复习日期 YYYY-MM-DD
  interval: 1       // 间隔天数
};

// 解析文件开头的 YAML frontmatter（--- ... ---），返回 { meta, body }
function parseFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { meta: {}, body: content };

  const meta = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  });

  return { meta, body: content.slice(m[0].length) };
}

// 把解析出的原始值规整成正确类型 + 默认值
function normalizeMeta(meta) {
  return {
    importance: parseInt(meta.importance, 10) || 0,
    lastReview: meta.lastReview || '',
    nextReview: meta.nextReview || '',
    interval: parseInt(meta.interval, 10) || 1
  };
}

// 序列化元数据为 frontmatter 文本（结尾带换行）
function stringifyFrontmatter(meta) {
  return [
    '---',
    `importance: ${meta.importance}`,
    `lastReview: '${meta.lastReview}'`,
    `nextReview: '${meta.nextReview}'`,
    `interval: ${meta.interval}`,
    '---'
  ].join('\n') + '\n';
}

// 读取某篇笔记的元数据（无 frontmatter 时返回默认值）
function readMeta(filePath) {
  if (!fs.existsSync(filePath)) return { ...DEFAULT_META };
  const { meta } = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
  return { ...DEFAULT_META, ...normalizeMeta(meta) };
}

// 列出所有 .md 笔记（含复习元数据）
ipcMain.handle('notes:list', () => {
  return fs.readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const name = f.replace(/\.md$/, '');
      return { name, ...readMeta(path.join(NOTES_DIR, f)) };
    });
});

// 读取笔记正文（剥离 frontmatter 元数据）
ipcMain.handle('notes:read', (_e, name) => {
  const filePath = path.join(NOTES_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) return '';
  const { body } = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
  return body;
});

// 写正文：保留已有 frontmatter 元数据，不破坏正文（notes:save / notes:flush 共用）
function writeNoteBody(filePath, content) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const { meta } = parseFrontmatter(existing);
  const merged = { ...DEFAULT_META, ...normalizeMeta(meta) };
  fs.writeFileSync(filePath, stringifyFrontmatter(merged) + content, 'utf-8');
}

// 保存笔记正文（保留已有 frontmatter 元数据，不破坏正文）
ipcMain.handle('notes:save', (_e, { name, content }) => {
  const safeName = String(name).trim();
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  writeNoteBody(filePath, content);
  return safeName;
});

// 窗口关闭前的兜底保存：同步写盘（renderer 用 sendSync 调用，确保写盘完成再关闭）
ipcMain.on('notes:flush', (e, { name, content }) => {
  const safeName = String(name).trim();
  if (!safeName) {
    e.returnValue = false;
    return;
  }
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  writeNoteBody(filePath, content);
  e.returnValue = true;
});

// 删除笔记
ipcMain.handle('notes:delete', (_e, name) => {
  const safeName = String(name).trim();
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return safeName;
});

// 设置笔记重要程度（1-5）：只改 frontmatter，不动正文
ipcMain.handle('notes:setImportance', (_e, { name, importance }) => {
  const safeName = String(name).trim();
  const imp = Math.min(5, Math.max(1, parseInt(importance, 10) || 1));
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const { meta, body } = parseFrontmatter(existing);
  const merged = { ...DEFAULT_META, ...normalizeMeta(meta), importance: imp };

  fs.writeFileSync(filePath, stringifyFrontmatter(merged) + body, 'utf-8');
  return merged;
});
