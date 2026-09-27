const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// FSRS 间隔重复算法（纯逻辑模块）
const { createCard, reviewCard, Rating, isDue } = require('./src/fsrs');

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

// ---- frontmatter 元数据解析/写入（importance + FSRS 复习卡片） ----

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

// 从 frontmatter 字段重建 FSRS card（没有字段时返回一张新卡，due=现在）
function metaToCard(meta) {
  const card = createCard();
  card.state = parseInt(meta.state, 10) || 0;
  card.stability = parseFloat(meta.stability) || 0;
  card.difficulty = parseFloat(meta.difficulty) || 0;
  card.reps = parseInt(meta.reps, 10) || 0;
  card.lapses = parseInt(meta.lapses, 10) || 0;
  card.learning_steps = parseInt(meta.learningSteps, 10) || 0;
  if (meta.due) card.due = new Date(meta.due);
  if (meta.lastReview) card.last_review = new Date(meta.lastReview);
  return card;
}

// 把 card 序列化成 frontmatter 的字符串字段
function cardToMeta(card) {
  return {
    state: String(card.state ?? 0),
    stability: String(card.stability ?? 0),
    difficulty: String(card.difficulty ?? 0),
    reps: String(card.reps ?? 0),
    lapses: String(card.lapses ?? 0),
    learningSteps: String(card.learning_steps ?? 0),
    due: card.due instanceof Date ? card.due.toISOString() : String(card.due ?? ''),
    lastReview: card.last_review instanceof Date ? card.last_review.toISOString() : ''
  };
}

// 生成 frontmatter 文本（结尾带换行）。复习过（reps>0）才写卡片字段。
function stringifyFrontmatter(importance, card) {
  const lines = ['---', `importance: ${importance}`];
  if (card && card.reps > 0) {
    const m = cardToMeta(card);
    lines.push(`state: ${m.state}`);
    lines.push(`stability: ${m.stability}`);
    lines.push(`difficulty: ${m.difficulty}`);
    lines.push(`reps: ${m.reps}`);
    lines.push(`lapses: ${m.lapses}`);
    lines.push(`learningSteps: ${m.learningSteps}`);
    lines.push(`due: '${m.due}'`);
    if (m.lastReview) lines.push(`lastReview: '${m.lastReview}'`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

// 读取一条笔记：importance + card + body
function readNote(filePath) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const { meta, body } = parseFrontmatter(content);
  return {
    importance: parseInt(meta.importance, 10) || 0,
    card: metaToCard(meta),
    body
  };
}

// 写一条笔记：frontmatter（importance + card）+ 正文
function writeNote(filePath, importance, card, content) {
  fs.writeFileSync(filePath, stringifyFrontmatter(importance, card) + content, 'utf-8');
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

// 保存笔记正文（保留 frontmatter 里的 importance 和复习卡片）
ipcMain.handle('notes:save', (_e, { name, content }) => {
  const safeName = String(name).trim();
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { importance, card } = readNote(filePath);
  writeNote(filePath, importance, card, content);
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
  const { importance, card } = readNote(filePath);
  writeNote(filePath, importance, card, content);
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

// 设置笔记重要程度（1-5）：只改 importance，不动正文和复习卡片
ipcMain.handle('notes:setImportance', (_e, { name, importance }) => {
  const safeName = String(name).trim();
  const imp = Math.min(5, Math.max(1, parseInt(importance, 10) || 1));
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { card, body } = readNote(filePath);
  writeNote(filePath, imp, card, body);
  return { name: safeName, importance: imp };
});

// 复习：返回今天到期的笔记（名称 + 正文），按到期时间排序
ipcMain.handle('notes:due', () => {
  const due = [];
  for (const f of fs.readdirSync(NOTES_DIR)) {
    if (!f.endsWith('.md')) continue;
    const name = f.replace(/\.md$/, '');
    const filePath = path.join(NOTES_DIR, f);
    const { card, body } = readNote(filePath);
    if (isDue(card)) due.push({ name, content: body, due: card.due });
  }
  due.sort((a, b) => new Date(a.due) - new Date(b.due));
  return due.map(({ name, content }) => ({ name, content }));
});

// 评分：用 FSRS 更新卡片并写回 frontmatter
ipcMain.handle('notes:rate', (_e, { name, rating }) => {
  const safeName = String(name).trim();
  const r = Math.min(4, Math.max(1, parseInt(rating, 10) || Rating.Good));
  const filePath = path.join(NOTES_DIR, `${safeName}.md`);
  const { importance, card, body } = readNote(filePath);
  const newCard = reviewCard(card, r);
  writeNote(filePath, importance, newCard, body);
  return { name: safeName, card: newCard };
});
