const noteList = document.getElementById('note-list');
const noteName = document.getElementById('note-name');
const editor = document.getElementById('editor');
const newBtn = document.getElementById('new-note');
const saveBtn = document.getElementById('save-note');

let currentNote = null; // 当前正在编辑的笔记名（不含扩展名）

// 刷新左侧列表
async function refreshList() {
  const notes = await window.notesAPI.list();
  noteList.innerHTML = '';

  notes.forEach((name) => {
    const li = document.createElement('li');

    const title = document.createElement('span');
    title.className = 'note-title';
    title.textContent = name;

    const delBtn = document.createElement('button');
    delBtn.className = 'note-delete';
    delBtn.textContent = '×';
    delBtn.title = '删除笔记';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(name);
    });

    li.appendChild(title);
    li.appendChild(delBtn);
    li.addEventListener('click', () => openNote(name));
    noteList.appendChild(li);
  });
}

// 打开某篇笔记
async function openNote(name) {
  currentNote = name;
  noteName.value = name;
  editor.value = await window.notesAPI.read(name);
}

// 保存核心逻辑：写文件并刷新列表（手动保存与自动保存共用）
async function doSave(name, content) {
  currentNote = await window.notesAPI.save(name, content);
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

newBtn.addEventListener('click', () => {
  currentNote = null;
  noteName.value = '';
  editor.value = '';
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

// ---- 自动保存 ----
const toast = document.getElementById('toast');
let saveTimer = null;
let toastTimer = null;

// 右上角轻提示
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
}

// 自动保存：仅对已保存过的笔记生效，只保存内容、不涉及改名
async function autoSave() {
  if (!currentNote) return; // 新建未保存：交给手动「保存」，避免自动创建空文件
  await doSave(currentNote, editor.value);
  showToast('已保存');
}

// 防抖：每次输入都重置计时器，停止输入 800ms 后才真正保存
function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, 800);
}

noteName.addEventListener('input', scheduleAutoSave);
editor.addEventListener('input', scheduleAutoSave);

refreshList();
