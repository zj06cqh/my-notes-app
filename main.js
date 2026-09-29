const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// 图片识别（OCR，tesseract.js）
const { createWorker, OEM } = require('tesseract.js');

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

// ---- frontmatter 元数据解析/写入（仅 importance） ----

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

// 生成 frontmatter 文本（仅 importance）
function stringifyFrontmatter(importance) {
  return `---\nimportance: ${importance}\n---\n`;
}

// 读取一条笔记：importance + body
function readNote(filePath) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const { meta, body } = parseFrontmatter(content);
  return {
    importance: parseInt(meta.importance, 10) || 0,
    body
  };
}

// 写一条笔记：frontmatter（importance）+ 正文
function writeNote(filePath, importance, content) {
  fs.writeFileSync(filePath, stringifyFrontmatter(importance) + content, 'utf-8');
}

// ---- IPC ----

// 列出所有 .md 笔记（名称 + 重要程度）
ipcMain.handle('notes:list', () => {
  return fs.readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const name = f.replace(/\.md$/, '');
      const { importance } = readNote(path.join(NOTES_DIR, f));
      return { name, importance };
    });
});

// 读取笔记正文（剥离 frontmatter）
ipcMain.handle('notes:read', (_e, name) => {
  const filePath = path.join(NOTES_DIR, `${String(name).trim()}.md`);
  if (!fs.existsSync(filePath)) return '';
  return readNote(filePath).body;
});

// 保存笔记正文（保留 frontmatter 里的 importance）
ipcMain.handle('notes:save', (_e, { name, content }) => {
  const safeName = String(name).trim();
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { importance } = readNote(filePath);
  writeNote(filePath, importance, content);
  return safeName;
});

// 窗口关闭前的兜底保存：同步写盘（renderer 用 sendSync 调用）
ipcMain.on('notes:flush', (e, { name, content }) => {
  const safeName = String(name).trim();
  if (!safeName) {
    e.returnValue = false;
    return;
  }
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { importance } = readNote(filePath);
  writeNote(filePath, importance, content);
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

// 设置笔记重要程度（1-5）：只改 importance，不动正文
ipcMain.handle('notes:setImportance', (_e, { name, importance }) => {
  const safeName = String(name).trim();
  const imp = Math.min(5, Math.max(1, parseInt(importance, 10) || 1));
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { body } = readNote(filePath);
  writeNote(filePath, imp, body);
  return { name: safeName, importance: imp };
});

// ---- 图片识别（OCR） ----

let ocrWorkerPromise = null; // 复用 worker 的 Promise，避免并发时重复创建
let ocrSender = null;        // 当前发起识别请求的窗口，用于回传进度

// 懒加载 worker：首次识别时创建（含语言包下载），之后复用
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
      cachePath: path.join(app.getPath('userData'), 'tesseract-cache'),
      logger: (m) => {
        if (ocrSender && !ocrSender.isDestroyed()) {
          ocrSender.send('ocr:progress', { status: m.status, progress: m.progress });
        }
      }
    }).catch((err) => {
      ocrWorkerPromise = null; // 失败后允许下次重试
      throw err;
    });
  }
  return ocrWorkerPromise;
}

// 读取剪贴板里的图片，返回 dataURL（没有图片则返回空串）
ipcMain.handle('clipboard:image', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? '' : img.toDataURL();
});

// OCR：识别 dataURL 里的图片，返回 { text } 或 { error }
ipcMain.handle('ocr:image', async (e, dataUrl) => {
  ocrSender = e.sender;
  try {
    const str = String(dataUrl);
    const commaIdx = str.indexOf(',');
    const base64 = commaIdx >= 0 ? str.slice(commaIdx + 1) : str;
    const buf = Buffer.from(base64, 'base64');
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(buf);
    return { text: data.text };
  } catch (err) {
    return { error: err.message || '识别失败' };
  }
});
