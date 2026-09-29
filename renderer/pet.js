// 桌面宠物：图片缺失/加载失败时移除，只保留泡泡本身，避免出现破碎图片图标
(function () {
  const img = document.getElementById('pet-img');
  if (img) {
    img.addEventListener('error', () => img.remove());
  }
})();
