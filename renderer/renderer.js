const noteList = document.getElementById('note-list');
const noteName = document.getElementById('note-name');
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const newBtn = document.getElementById('new-note');
const saveBtn = document.getElementById('save-note');
const startReviewBtn = document.getElementById('start-review');
const reviewMode = document.getElementById('review-mode');
const reviewExitBtn = document.getElementById('review-exit');
const reviewProgress = document.getElementById('review-progress');
const reviewTitle = document.getElementById('review-title');
const reviewContent = document.getElementById('review-content');
const reviewAi = document.getElementById('review-ai');
const reviewAiLoading = document.getElementById('review-ai-loading');
const reviewAiBody = document.getElementById('review-ai-body');
const reviewSummary = document.getElementById('review-summary');
const reviewQuestion = document.getElementById('review-question');
const reviewToggle = document.getElementById('review-toggle');
const reviewDone = document.getElementById('review-done');

let currentNote = null;      // 当前正在编辑的笔记名（不含扩展名）
let lastSavedContent = '';   // 当前笔记已写盘的内容，用于判断是否有变化

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
}

// 打开某篇笔记
async function openNote(name) {
  await flushSave(); // 切换笔记前，先强制保存当前笔记（不等防抖）
  currentNote = name;
  noteName.value = name;
  editor.value = await window.notesAPI.read(name);
  lastSavedContent = editor.value; // 刚读到的内容即已写盘内容
  renderPreview();
}

// 保存核心逻辑：写文件并刷新列表（手动保存与自动保存共用）
async function doSave(name, content) {
  currentNote = await window.notesAPI.save(name, content);
  lastSavedContent = content; // 记录已写盘内容，供「无变化不重复写」判断
  await refreshList();
}

// 手动保存：以标题框内容作为文件名（新建或改名）
async function saveNote() {
  const name = noteName.value.trim();
  if (!name) return;

  await doSave(name, editor.value);
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
    editor.value = '';
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
  editor.value = '';
  lastSavedContent = '';
  renderPreview();
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
  if (editor.value === lastSavedContent) return; // 内容没变化，不重复写文件
  await doSave(currentNote, editor.value);
}

// 防抖自动保存：每次输入都重置计时器，停止输入 800ms 后静默写盘
function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

// 粘贴后立即保存（等粘贴内容写入 textarea 后再读，避免读到旧值）
editor.addEventListener('paste', () => {
  setTimeout(flushSave, 0);
});

// 窗口关闭前，把未保存内容同步写盘（同步 IPC，确保写盘完成再关闭）
window.addEventListener('beforeunload', () => {
  if (currentNote && editor.value !== lastSavedContent) {
    window.notesAPI.flushSync(currentNote, editor.value);
  }
});

noteName.addEventListener('input', scheduleAutoSave);
editor.addEventListener('input', scheduleAutoSave);

// ---- Markdown 实时预览 ----
let previewTimer = null;

function renderPreview() {
  const html = marked.parse(editor.value);
  preview.innerHTML = DOMPurify.sanitize(html);
}

// 防抖 300ms：停止输入 300ms 后更新预览
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 300);
}

editor.addEventListener('input', schedulePreview);

// ---- 复习模式 ----
let reviewQueue = [];   // 待复习笔记 [{ name, content }]
let reviewIndex = 0;
let reviewToken = 0;    // 每次展示递增，用于丢弃过期的异步 AI 结果

async function startReview() {
  await flushSave(); // 进入复习前先保存当前笔记
  const due = await window.notesAPI.getDue();
  if (due.length === 0) {
    showToast('今天没有需要复习的笔记', 1500);
    return;
  }
  reviewQueue = due;
  reviewIndex = 0;
  reviewMode.classList.remove('hidden');
  showReviewCard();
}

function showReviewCard() {
  const token = ++reviewToken; // 本次展示的标记

  // 全部复习完：显示完成态
  if (reviewIndex >= reviewQueue.length) {
    reviewTitle.textContent = '';
    reviewProgress.textContent = '';
    reviewDone.textContent = '今日复习完成 🎉';
    reviewDone.classList.remove('hidden');
    reviewAi.classList.add('hidden');
    reviewToggle.classList.add('hidden');
    reviewContent.classList.add('hidden');
    return;
  }

  const item = reviewQueue[reviewIndex];
  reviewTitle.textContent = item.name;
  reviewProgress.textContent = `第 ${reviewIndex + 1} / ${reviewQueue.length} 条`;
  reviewDone.classList.add('hidden');

  // 原文先渲染好但默认收起，点“查看原文”再展开
  reviewContent.innerHTML = DOMPurify.sanitize(marked.parse(item.content));
  reviewContent.classList.add('hidden');
  reviewToggle.textContent = '查看原文';
  reviewToggle.classList.add('hidden');

  // AI 加载态
  reviewAi.classList.remove('hidden');
  reviewAiLoading.classList.remove('hidden');
  reviewAiBody.classList.add('hidden');
  reviewSummary.textContent = '';
  reviewQuestion.textContent = '';

  // 异步生成 AI 总结 + 问题；失败则跳过 AI、直接展开原文，绝不影响评分
  window.notesAPI.getAI(item.name).then((res) => {
    if (token !== reviewToken) return; // 已切到下一张卡，丢弃过期结果
    if (!res || res.error) throw new Error(res && res.error ? res.error : 'AI 调用失败');
    reviewSummary.textContent = res.summary || '';
    reviewQuestion.textContent = res.question || '';
    reviewAiLoading.classList.add('hidden');
    reviewAiBody.classList.remove('hidden');
    reviewToggle.classList.remove('hidden'); // 显示“查看原文”
  }).catch(() => {
    if (token !== reviewToken) return;
    reviewAi.classList.add('hidden');        // 跳过 AI 部分
    reviewContent.classList.remove('hidden'); // 直接显示原文
  });
}

async function rateAndNext(rating) {
  if (reviewIndex >= reviewQueue.length) return;
  const item = reviewQueue[reviewIndex];
  await window.notesAPI.rate(item.name, rating);
  reviewIndex++;
  showReviewCard();
}

function exitReview() {
  reviewMode.classList.add('hidden');
  refreshList();
}

// 查看 / 收起原文
reviewToggle.addEventListener('click', () => {
  const hidden = reviewContent.classList.toggle('hidden');
  reviewToggle.textContent = hidden ? '查看原文' : '收起原文';
});

startReviewBtn.addEventListener('click', startReview);
reviewExitBtn.addEventListener('click', exitReview);
document.querySelectorAll('.rating').forEach((btn) => {
  btn.addEventListener('click', () => rateAndNext(parseInt(btn.dataset.rating, 10)));
});

refreshList();
