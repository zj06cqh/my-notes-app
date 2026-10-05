const noteList = document.getElementById('note-list');
const noteName = document.getElementById('note-name');
const editorEl = document.getElementById('editor');
const newBtn = document.getElementById('new-note');
const saveBtn = document.getElementById('save-note');
const ocrFileBtn = document.getElementById('ocr-file');
const ocrClipboardBtn = document.getElementById('ocr-clipboard');
const ocrFileInput = document.getElementById('ocr-file-input');

let currentNote = null;      // 当前正在编辑的笔记名（不含扩展名）
let lastSavedContent = '';   // 当前笔记已写盘的内容，用于判断是否有变化

// Tiptap 富文本编辑器实例（onUpdate 在正文变化时回调，驱动自动保存）
const editor = window.createNoteEditor(editorEl, {
  placeholder: '在这里写 Markdown...',
  onUpdate: () => scheduleAutoSave()
});

// HTML 转义
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 纯文本 → HTML：换行转 <br>（供 OCR 插入使用）
function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// 读取的正文 → 编辑器内容：已是 HTML 原样返回；旧纯文本按行转 <p> 段落
function bodyToHtml(body) {
  if (!body) return '<p></p>';
  if (/<\/?[a-z][^>]*>/i.test(body)) return body;
  return body.split(/\r?\n/).map((line) => {
    const t = line.trim();
    return t ? `<p>${escapeHtml(line)}</p>` : '<p></p>';
  }).join('');
}

// 刷新左侧列表
async function refreshList() {
  const notes = await window.notesAPI.list();
  noteList.innerHTML = '';

  notes.forEach((note) => {
    const li = document.createElement('li');

    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = note.name;

    const imp = document.createElement('button');
    imp.className = 'note-importance' + (note.importance > 0 ? ` note-importance-${note.importance}` : '');
    imp.textContent = note.importance > 0 ? String(note.importance) : '·';
    imp.title = '重要程度（点击修改 1-5）';
    imp.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleImportance(note.name, note.importance);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'note-delete';
    delBtn.textContent = '×';
    delBtn.title = '删除笔记';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(note.name);
    });

    li.appendChild(title);
    li.appendChild(imp);
    li.appendChild(delBtn);
    li.addEventListener('click', () => openNote(note.name));
    noteList.appendChild(li);
  });

  markActive();
}

// 高亮当前正在编辑的笔记（侧栏 active 态）
function markActive() {
  document.querySelectorAll('#note-list li').forEach((li) => {
    const title = li.querySelector('.note-title');
    li.classList.toggle('active', !!(title && title.textContent === currentNote));
  });
}

// 打开某篇笔记
async function openNote(name) {
  await flushSave(); // 切换笔记前，先强制保存当前笔记（不等防抖）
  currentNote = name;
  noteName.value = name;
  const raw = await window.notesAPI.read(name);
  editor.commands.setContent(bodyToHtml(raw));
  lastSavedContent = editor.getHTML(); // 归一化后的内容作为「已写盘」基准
  markActive();
}

// 保存核心逻辑：写文件并刷新列表（手动保存与自动保存共用）
async function doSave(name, content) {
  currentNote = await window.NoteStore.save(name, content);
  lastSavedContent = content; // 记录已写盘内容，供「无变化不重复写」判断
  await refreshList();
}

// 手动保存：以标题框内容作为文件名（新建或改名）
async function saveNote() {
  const name = noteName.value.trim();
  if (!name) return;

  await doSave(name, editor.getHTML());
}

// 删除某篇笔记（带确认，防误删）
async function deleteNote(name) {
  const ok = window.confirm(`确定删除「${name}」吗？删除后无法恢复。`);
  if (!ok) return;

  await window.notesAPI.remove(name);

  // 如果删除的是当前正在编辑的笔记，清空编辑区
  if (currentNote === name) {
    currentNote = null;
    noteName.value = '';
    editor.commands.setContent('<p></p>');
  }

  await refreshList();
}

// 点击重要程度徽标：循环 1 → 2 → ... → 5 → 1
async function cycleImportance(name, current) {
  const next = current >= 5 ? 1 : current + 1;
  await window.notesAPI.setImportance(name, next);
  await refreshList();
  showToast(`重要度已设为 ${next}`, 1000);
}

newBtn.addEventListener('click', async () => {
  await flushSave(); // 新建前先保存当前笔记
  currentNote = null;
  noteName.value = '';
  editor.commands.setContent('<p></p>');
  lastSavedContent = '';
  markActive();
  noteName.focus();
});

saveBtn.addEventListener('click', saveNote);

// Ctrl/Cmd + S 保存
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveNote();
  }
});

// ---- 自动保存（静默，无任何提示） ----
const toast = document.getElementById('toast');
let saveTimer = null;
let toastTimer = null;

// 轻提示（仅重要程度按钮等交互反馈使用，自动保存不再调用）
function showToast(msg, duration = 1500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// 有变化才真正写盘；没变化则跳过（自动保存与三处强制保存共用）
async function flushSave() {
  if (!currentNote) return; // 新建未保存：交给手动「保存」，避免自动创建空文件
  if (editor.getHTML() === lastSavedContent) return; // 内容没变化，不重复写文件
  await doSave(currentNote, editor.getHTML());
}

// 防抖自动保存：每次输入都重置计时器，停止输入 800ms 后静默写盘
function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

// 窗口关闭前，把未保存内容同步写盘（同步 IPC，确保写盘完成再关闭）
window.addEventListener('beforeunload', () => {
  if (currentNote && editor.getHTML() !== lastSavedContent) {
    window.notesAPI.flushSync(currentNote, editor.getHTML());
  }
});

noteName.addEventListener('input', scheduleAutoSave);

// ---- 图片识别（OCR） ----

// 显示识别进度（复用 #toast，但不自动隐藏）
function showOcrStatus(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
}

function hideOcrStatus() {
  toast.classList.remove('show');
}

// 在编辑区当前光标处插入文本（OCR 结果）
function insertAtCursor(text) {
  editor.chain().focus().insertContent(textToHtml(text)).run();
  scheduleAutoSave(); // 触发自动保存
}

// 执行 OCR：dataUrl → 识别文本 → 插入光标处
async function runOcr(dataUrl) {
  showOcrStatus('正在准备识别...');
  try {
    const res = await window.notesAPI.ocrImage(dataUrl);
    if (res && res.error) throw new Error(res.error);
    hideOcrStatus();
    const text = (res && res.text) ? res.text : '';
    if (text.trim()) {
      insertAtCursor(text.trim() + '\n');
      showToast('识别完成', 1500);
    } else {
      showToast('识别完成，但未识别到文字', 2500);
    }
  } catch (e) {
    hideOcrStatus();
    showToast('识别失败：' + (e && e.message ? e.message : '未知错误'), 3000);
  }
}

// OCR 进度回传
window.notesAPI.onOcrProgress(({ status, progress }) => {
  const pct = Math.round((progress || 0) * 100);
  if (status === 'recognizing text') {
    showOcrStatus(`识别中 ${pct}%`);
  } else if (status === 'loading language traineddata') {
    showOcrStatus(`加载语言包 ${pct}%`);
  } else {
    showOcrStatus('正在准备识别...');
  }
});

// 从文件选择图片
ocrFileInput.addEventListener('change', () => {
  const file = ocrFileInput.files && ocrFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => runOcr(reader.result);
  reader.onerror = () => showToast('读取图片失败', 2000);
  reader.readAsDataURL(file);
  ocrFileInput.value = ''; // 清空，允许再次选择同一文件
});
ocrFileBtn.addEventListener('click', () => ocrFileInput.click());

// 从剪贴板读取图片
ocrClipboardBtn.addEventListener('click', async () => {
  const dataUrl = await window.notesAPI.readClipboardImage();
  if (!dataUrl) {
    showToast('剪贴板里没有图片', 2000);
    return;
  }
  runOcr(dataUrl);
});

refreshList();

// 点击宠物小气泡 → 打开对应笔记到编辑器
window.notesAPI.onOpenNote((name) => {
  openNote(name);
});
