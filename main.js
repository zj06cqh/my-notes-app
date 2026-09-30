const { app, BrowserWindow, ipcMain, clipboard, screen } = require('electron');
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

// ---- 桌面宠物泡泡：拖动才动 + 阻尼滑行 + 边界反弹（性能优化版） ----

const PET_SIZE = 200;       // 泡泡窗口固定宽高（高 DPI 下需显式锁定，避免尺寸漂移）
const damping = 0.98;       // 每帧阻尼系数（松手后慢慢停下）
const stopThreshold = 0.05; // 速度绝对值低于此值即归零停止（px/帧）
const bounceLoss = 0.8;     // 碰边碰撞损耗
const flickCoeff = 0.5;     // 拖动末速度 -> 初速度 的系数

let petWin = null;                           // 宠物窗口引用
let petState = { x: 0, y: 0, vx: 0, vy: 0 }; // 位置 + 速度（单位：px、px/帧）
let petDragging = false;                     // 是否正在拖动
let petTimer = null;                         // 滑行帧循环定时器（静止时不启动）
let petWorkArea = null;                      // 主屏幕 workArea（创建窗口时读取）
let petDragStartMouse = { x: 0, y: 0 };      // 拖动起点：鼠标屏幕坐标
let petDragStartWin = { x: 0, y: 0 };        // 拖动起点：窗口位置
let petLastMouse = { x: 0, y: 0 };           // 上一次 mousemove 位置（算速度）
let petLastMouseTime = 0;                    // 上一次 mousemove 时间
let petDragVel = { x: 0, y: 0 };             // 拖动末速度（px/帧）

// 窗口内容盒：窗口原点相对泡泡槽位左上角的偏移 + 窗口尺寸。
// 由渲染进程按「泡泡 + 小气泡 + 气泡对话框」的包围盒上报，主进程据此定位窗口。
let petContentBox = { ox: 0, oy: 0, w: PET_SIZE, h: PET_SIZE };

// ---- 小气泡持久化（单独 JSON，见下方 load/save） ----
const PET_BUBBLES_FILE = path.join(__dirname, 'pet-bubbles.json');
let petBubbles = [];                         // [{ note, x, y }]，x/y = 相对泡泡槽位左上角（DIP）

function loadPetBubbles() {
  try {
    if (fs.existsSync(PET_BUBBLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PET_BUBBLES_FILE, 'utf-8'));
      const arr = Array.isArray(data.bubbles) ? data.bubbles : [];
      // 清理孤儿：笔记文件已不存在的小气泡不加载
      petBubbles = arr.filter((b) => b && typeof b.note === 'string' &&
        fs.existsSync(path.join(NOTES_DIR, `${b.note}.md`)));
    } else {
      petBubbles = [];
    }
  } catch (e) {
    petBubbles = [];
  }
}

function savePetBubbles() {
  try {
    fs.writeFileSync(PET_BUBBLES_FILE, JSON.stringify({ bubbles: petBubbles }, null, 2), 'utf-8');
  } catch (e) { /* 写盘失败不致命 */ }
}

// 移动窗口：先查尺寸是否漂移，正常走轻量 setPosition，漂移才用 setBounds 锁回
function movePetWindow() {
  const { ox, oy, w, h } = petContentBox;
  const x = Math.round(petState.x + ox);
  const y = Math.round(petState.y + oy);
  const b = petWin.getBounds();
  if (b.width === w && b.height === h) {
    petWin.setPosition(x, y);
  } else {
    petWin.setBounds({ x, y, width: w, height: h });
  }
}

// 启动滑行帧循环（仅在速度不为 0 时调用）
function startPetTimer() {
  if (petTimer) return;
  petTimer = setInterval(petStep, 16);
}

// 停止帧循环（速度归零 / 拖动开始 / 窗口关闭时调用）
function stopPetTimer() {
  if (petTimer) { clearInterval(petTimer); petTimer = null; }
}

// 单帧推进：阻尼衰减 -> 归零判定 -> 位移 -> 边界反弹 -> 移动窗口
function petStep() {
  if (petDragging) return;

  // 阻尼衰减
  petState.vx *= damping;
  petState.vy *= damping;

  // 速度接近 0：直接归零，彻底停住并停掉定时器（不空跑 60fps）
  if (Math.abs(petState.vx) < stopThreshold && Math.abs(petState.vy) < stopThreshold) {
    petState.vx = 0;
    petState.vy = 0;
    stopPetTimer();
    return;
  }

  petState.x += petState.vx;
  petState.y += petState.vy;

  // 边界：整个泡泡（窗口）都在 workArea 内；钳回边界 + 反向并损耗
  const maxX = petWorkArea.x + petWorkArea.width - PET_SIZE;
  const maxY = petWorkArea.y + petWorkArea.height - PET_SIZE;
  if (petState.x < petWorkArea.x) { petState.vx = -petState.vx * bounceLoss; petState.x = petWorkArea.x; }
  if (petState.x > maxX) { petState.vx = -petState.vx * bounceLoss; petState.x = maxX; }
  if (petState.y < petWorkArea.y) { petState.vy = -petState.vy * bounceLoss; petState.y = petWorkArea.y; }
  if (petState.y > maxY) { petState.vy = -petState.vy * bounceLoss; petState.y = maxY; }

  movePetWindow();
}

function createPetWindow() {
  petWin = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    transparent: true,
    backgroundColor: '#00000000', // 避免加载前出现白/黑底闪烁
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false, // 关掉原生阴影，泡泡阴影用 CSS 做
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // 拖动需要 preload 暴露的 petAPI
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const { workArea } = screen.getPrimaryDisplay();
  petWorkArea = workArea;
  const margin = 20;

  // 初始静止：位置右下角，速度 0，不启动定时器
  petState.x = workArea.x + workArea.width - PET_SIZE - margin;
  petState.y = workArea.y + workArea.height - PET_SIZE - margin;
  petState.vx = 0;
  petState.vy = 0;
  movePetWindow();

  // 默认鼠标穿透（转发 mousemove），由渲染进程在泡泡/气泡上动态关穿透
  petWin.setIgnoreMouseEvents(true, { forward: true });

  // 窗口关闭时清除定时器，避免泄漏
  petWin.on('closed', () => {
    stopPetTimer();
    petWin = null;
  });

  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
}

// ---- 桌面宠物 IPC（拖动） ----
ipcMain.on('pet:drag-start', (_e, { screenX, screenY }) => {
  petDragging = true;
  stopPetTimer(); // 拖动期间不跑滑行循环
  petDragStartMouse.x = screenX;
  petDragStartMouse.y = screenY;
  petDragStartWin.x = petState.x;
  petDragStartWin.y = petState.y;
  petLastMouse.x = screenX;
  petLastMouse.y = screenY;
  petLastMouseTime = Date.now();
  petDragVel.x = 0;
  petDragVel.y = 0;
});

ipcMain.on('pet:drag-move', (_e, { screenX, screenY }) => {
  if (!petDragging || !petWin) return;

  // 算拖动末速度（px/帧）：最后一段位移 / 时间 * 16ms/帧
  const now = Date.now();
  const dt = now - petLastMouseTime;
  if (dt > 0) {
    petDragVel.x = (screenX - petLastMouse.x) / dt * 16;
    petDragVel.y = (screenY - petLastMouse.y) / dt * 16;
  }
  petLastMouse.x = screenX;
  petLastMouse.y = screenY;
  petLastMouseTime = now;

  // 跟随鼠标（保持抓取偏移）
  petState.x = petDragStartWin.x + (screenX - petDragStartMouse.x);
  petState.y = petDragStartWin.y + (screenY - petDragStartMouse.y);

  // 拖动时同样限制在 workArea 内（和滑行一致的边界）
  const maxX = petWorkArea.x + petWorkArea.width - PET_SIZE;
  const maxY = petWorkArea.y + petWorkArea.height - PET_SIZE;
  if (petState.x < petWorkArea.x) petState.x = petWorkArea.x;
  if (petState.x > maxX) petState.x = maxX;
  if (petState.y < petWorkArea.y) petState.y = petWorkArea.y;
  if (petState.y > maxY) petState.y = maxY;

  movePetWindow();
});

ipcMain.on('pet:drag-end', () => {
  petDragging = false;

  // 松手：拖动末速度 * 系数 作为初速度
  petState.vx = petDragVel.x * flickCoeff;
  petState.vy = petDragVel.y * flickCoeff;

  // 几乎没动就保持静止，不启动定时器
  if (Math.abs(petState.vx) < stopThreshold && Math.abs(petState.vy) < stopThreshold) {
    petState.vx = 0;
    petState.vy = 0;
    return;
  }

  startPetTimer(); // 有速度，开始阻尼滑行
});

// 渲染进程上报内容盒（泡泡+小气泡+气泡的包围盒），主进程据此定位/缩放窗口
ipcMain.on('pet:set-content-box', (_e, { ox, oy, w, h }) => {
  petContentBox = {
    ox: Math.round(ox),
    oy: Math.round(oy),
    w: Math.round(w),
    h: Math.round(h)
  };
  movePetWindow();
});

// 小气泡：读取当前列表
ipcMain.handle('pet:get-bubbles', () => petBubbles);

// 小气泡：新增一条（note 为文件名，x/y 为相对泡泡槽位左上角的位置）
ipcMain.handle('pet:add-bubble', (_e, { note, x, y }) => {
  const n = String(note || '').trim();
  if (!n) return petBubbles;
  petBubbles.push({ note: n, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) });
  savePetBubbles();
  return petBubbles;
});

// 动态鼠标穿透：透明区域穿透到下层应用，泡泡/气泡上才接收鼠标
ipcMain.on('pet:set-ignore-mouse', (_e, ignore) => {
  if (!petWin) return;
  petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
});

app.whenReady().then(() => {
  // 确保笔记目录存在
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR);
  }

  loadPetBubbles(); // 先加载小气泡，再创建宠物窗口（渲染进程会读取）
  createWindow();
  createPetWindow();

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
