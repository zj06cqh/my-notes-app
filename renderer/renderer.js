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
    li.textContent = name;
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

// 保存当前笔记
async function saveNote() {
  const name = noteName.value.trim();
  if (!name) return;

  currentNote = await window.notesAPI.save(name, editor.value);
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

refreshList();
