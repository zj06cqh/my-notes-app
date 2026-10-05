// 桌面宠物：单击弹气泡 / 拖动移动（带阻尼滑行由主进程负责）/ 保存后生成小气泡
// 鼠标穿透：透明区域穿透到下层应用，泡泡/气泡上才接收鼠标
(function () {
  // 图片加载失败时移除，避免出现破碎图片图标
  const img = document.getElementById('pet-img');
  if (img) {
    img.addEventListener('error', () => img.remove());
  }

  const bubble = document.getElementById('pet-bubble');
  const bubblesEl = document.getElementById('bubbles');
  const dialog = document.getElementById('dialog');
  const dialogInput = document.getElementById('dialog-input');
  const dialogSave = document.getElementById('dialog-save');
  if (!bubble || !window.petAPI) return;

  // Tiptap 富文本输入框（与主窗口同一套编辑器，粘贴保留颜色）
  const editor = window.createNoteEditor(dialogInput, { placeholder: '记点什么…' });

  // ---- 几何常量（DIP） ----
  const PET = 200;        // 泡泡槽位宽高
  const GAP = 12;         // 泡泡与气泡之间的间距
  const BUBBLE_R = 20;    // 小气泡半径（直径 40px）

  // 状态
  let dialogOpen = false;
  let dirX = 'right';     // 气泡相对泡泡的水平方向：right / left
  let dirY = 'down';      // 垂直方向：down / up
  let contentOx = 0;      // 当前窗口原点相对泡泡槽位左上角的偏移（由 relayout 维护）
  let contentOy = 0;
  let bubbles = [];       // [{ note, x, y, el }]，x/y = 小气泡圆心相对泡泡槽位左上角（DIP）

  // 主屏可用区域（= 主进程 screen.getPrimaryDisplay().workArea）
  function workArea() {
    return {
      x: window.screen.availLeft,
      y: window.screen.availTop,
      w: window.screen.availWidth,
      h: window.screen.availHeight
    };
  }

  // 泡泡槽位左上角的屏幕坐标 = 窗口原点 − 内容盒偏移
  function getPetAnchor() {
    return { x: window.screenX - contentOx, y: window.screenY - contentOy };
  }

  // 根据「泡泡 + 小气泡 + 气泡对话框」的包围盒，摆放元素并上报窗口内容盒
  function relayout() {
    // 本地坐标系：泡泡槽位左上角 = (0,0)，泡泡占 (0,0)-(200,200)
    let minX = 0, minY = 0, maxX = PET, maxY = PET;

    bubbles.forEach((b) => {
      minX = Math.min(minX, b.x - BUBBLE_R);
      maxX = Math.max(maxX, b.x + BUBBLE_R);
      minY = Math.min(minY, b.y - BUBBLE_R);
      maxY = Math.max(maxY, b.y + BUBBLE_R);
    });

    let dlgX = 0, dlgY = 0;
    if (dialogOpen) {
      const dlgW = dialog.offsetWidth;
      const dlgH = dialog.offsetHeight;
      dlgX = dirX === 'right' ? PET + GAP : -dlgW - GAP;
      dlgY = dirY === 'down' ? PET + GAP : -dlgH - GAP;
      minX = Math.min(minX, dlgX);
      maxX = Math.max(maxX, dlgX + dlgW);
      minY = Math.min(minY, dlgY);
      maxY = Math.max(maxY, dlgY + dlgH);
    }

    const ox = minX, oy = minY;
    const w = maxX - minX, h = maxY - minY;
    contentOx = ox;
    contentOy = oy;

    bubble.style.left = (0 - ox) + 'px';
    bubble.style.top = (0 - oy) + 'px';

    if (dialogOpen) {
      dialog.style.left = (dlgX - ox) + 'px';
      dialog.style.top = (dlgY - oy) + 'px';
    }

    syncBubblePositions();

    window.petAPI.setContentBox({ ox, oy, w, h });
  }

  // 更新已存在的小气泡 DOM 位置（窗口坐标）
  function syncBubblePositions() {
    bubbles.forEach((b) => {
      if (!b.el) return;
      b.el.style.left = (b.x - BUBBLE_R - contentOx) + 'px';
      b.el.style.top = (b.y - BUBBLE_R - contentOy) + 'px';
    });
  }

  // 重建小气泡 DOM（列表变化时调用）
  function renderBubbles() {
    bubblesEl.innerHTML = '';
    bubbles.forEach((b) => {
      const el = document.createElement('div');
      el.className = 'mini-bubble';
      el.dataset.note = b.note;
      el.title = b.note;
      // 随机漂浮周期(2~4s)与相位(负 delay 提前进周期)，避免所有小球同步起伏
      el.style.animationDuration = (2 + Math.random() * 2).toFixed(2) + 's';
      el.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
      b.el = el;
      bubblesEl.appendChild(el);
    });
    syncBubblePositions();
  }

  // 小气泡环形散布：圆心在泡泡中心附近一圈，随机半径/角度，不跟泡泡重叠
  function randomRingPos() {
    const angle = Math.random() * Math.PI * 2;
    const r = 130 + Math.random() * 40; // 130~170 px
    return {
      x: Math.round(PET / 2 + r * Math.cos(angle)),
      y: Math.round(PET / 2 + r * Math.sin(angle))
    };
  }

  function openBubble() {
    if (dialogOpen) return;

    // 冒出方向：泡泡中心在屏幕哪半边，就往另一侧冒，避免超出
    const anchor = getPetAnchor();
    const wa = workArea();
    const cx = anchor.x + PET / 2;
    const cy = anchor.y + PET / 2;
    dirX = cx < wa.x + wa.w / 2 ? 'right' : 'left';
    dirY = cy < wa.y + wa.h / 2 ? 'down' : 'up';

    dialog.classList.add('open');
    dialogOpen = true;
    editor.commands.focus();
    relayout();
  }

  function collapse() {
    if (!dialogOpen) return;
    dialogOpen = false;
    dialog.classList.remove('open');
    editor.commands.setContent('<p></p>'); // 清空（编辑器自动缩回高度）
    relayout(); // 内容盒变回「泡泡 + 小气泡」
  }

  function toggleBubble() {
    if (dialogOpen) collapse();
    else openBubble();
  }

  // 气泡尺寸变化（输入撑大）时，同步窗口 bounds
  new ResizeObserver(() => {
    if (dialogOpen) relayout();
  }).observe(dialog);

  // ---- 鼠标穿透切换 ----
  let ignoring = true; // 与主进程默认值一致：启动即穿透

  function setIgnore(ignore) {
    if (ignore === ignoring) return;
    ignoring = ignore;
    window.petAPI.setIgnoreMouse(ignore);
  }

  // mousemove 时根据命中元素切换穿透；拖动/按压期间不切换，避免打断
  function onHoverMove(e) {
    if (pressing || dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const interactive = !!(el && el.closest('.bubble, .dialog, .mini-bubble'));
    setIgnore(!interactive);
  }
  window.addEventListener('mousemove', onHoverMove);

  // ---- 单击 vs 拖动：鼠标位移 − 窗口位移，排除滑行时窗口自身移动的干扰 ----
  const DRAG_THRESHOLD = 4;
  let pressing = false;
  let dragging = false;
  let pressX = 0;
  let pressY = 0;
  let pressWinX = 0; // 按下瞬间窗口位置，用于扣除窗口自身位移
  let pressWinY = 0;

  bubble.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (dialogOpen) { collapse(); return; } // 气泡开着时点泡泡 = 收起

    pressing = true;
    dragging = false;
    pressX = e.screenX;
    pressY = e.screenY;
    pressWinX = window.screenX;
    pressWinY = window.screenY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!pressing) return;

    // 有效位移 = 鼠标位移 − 窗口位移（窗口滑行时鼠标即使跟着动，两者相消）
    const effDx = (e.screenX - pressX) - (window.screenX - pressWinX);
    const effDy = (e.screenY - pressY) - (window.screenY - pressWinY);

    if (!dragging && (Math.abs(effDx) > DRAG_THRESHOLD || Math.abs(effDy) > DRAG_THRESHOLD)) {
      dragging = true;
      bubblesEl.classList.add('hidden'); // 拖动开始：隐藏全部小气泡
      window.petAPI.dragStart(e.screenX, e.screenY); // 用当前点，grab 偏移才准
    }
    if (dragging) {
      window.petAPI.dragMove(e.screenX, e.screenY);
    }
  });

  window.addEventListener('mouseup', () => {
    if (!pressing) return;
    pressing = false;
    if (dragging) {
      dragging = false;
      window.petAPI.dragEnd();
    } else {
      toggleBubble(); // 没超过阈值 = 单击
    }
  });

  // 点气泡外面（点击穿透到下层应用）→ 窗口失焦 → 收起
  window.addEventListener('blur', () => {
    if (dialogOpen) collapse();
  });

  // ---- 保存：写盘 + 生成小气泡 ----
  async function saveFromBubble() {
    const text = editor.getText().trim();
    if (!text) return;

    let note;
    try {
      note = await window.NoteStore.create(editor.getHTML()); // 复用公共模块：按时间生成文件名写盘
    } catch (err) {
      return; // 保存失败保持气泡不收起，方便用户重试/复制内容
    }

    // 在泡泡附近随机生成一个小气泡，并持久化
    const pos = randomRingPos();
    try {
      const list = await window.petAPI.addBubble({ note, x: pos.x, y: pos.y });
      bubbles = (list || []).map((b) => ({ note: b.note, x: b.x, y: b.y }));
    } catch (err) {
      bubbles = [];
    }

    collapse();      // 收起（relayout 会把新小气泡算进包围盒）
    renderBubbles(); // 重建 DOM 并按新内容盒定位
  }

  dialogSave.addEventListener('click', saveFromBubble);
  dialogInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveFromBubble();
    }
  });

  // ---- 启动：加载已持久化的小气泡 ----
  (async function init() {
    try {
      const list = await window.petAPI.getBubbles();
      bubbles = (list || []).map((b) => ({ note: b.note, x: b.x, y: b.y }));
    } catch (err) {
      bubbles = [];
    }
    renderBubbles();
    relayout();
  })();

  // 笔记被删除时，主进程推送最新小气泡列表，立即刷新（无需重启）
  window.petAPI.onBubblesChanged((list) => {
    bubbles = (list || []).map((b) => ({ note: b.note, x: b.x, y: b.y }));
    renderBubbles();
    relayout();
  });

  // 泡泡完全静止后（滑行归零），重新显示小气泡
  window.petAPI.onPetStopped(() => {
    bubblesEl.classList.remove('hidden');
  });

  // 点击小气泡 → 打开对应笔记（事件委托，靠 data-note 定位）
  bubblesEl.addEventListener('click', (e) => {
    const el = e.target.closest('.mini-bubble');
    if (!el || !el.dataset.note) return;
    window.petAPI.openNote(el.dataset.note);
  });
})();
