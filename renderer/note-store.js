// 笔记保存公共模块：主窗口与气泡共用
// 只通过 preload 暴露的 notesAPI 走 IPC，渲染进程不直接碰文件系统
(function () {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // 按时间生成文件名：2026-09-30-1530（分钟粒度）
  function timestampName() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // 保存：name 为不含扩展名的文件名，content 为正文；返回实际保存的文件名
  async function save(name, content) {
    return window.notesAPI.save(name, content);
  }

  // 新建一条：按时间生成文件名，同分钟已有同名则追加 -2、-3 … 避免覆盖
  async function create(content) {
    const list = await window.notesAPI.list();
    const existing = new Set(list.map((n) => n.name));

    let name = timestampName();
    const base = name;
    let i = 2;
    while (existing.has(name)) {
      name = `${base}-${i}`;
      i += 1;
    }

    return save(name, content);
  }

  window.NoteStore = { save, create, timestampName };
})();
