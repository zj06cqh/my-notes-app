// FSRS 间隔重复算法模块 —— 纯逻辑，不碰界面、不碰文件读写，便于单独测试。
// 基于 ts-fsrs：https://github.com/open-spaced-repetition/ts-fsrs
const { fsrs, createEmptyCard, Rating, generatorParameters } = require('ts-fsrs');

// 单例调度器。关闭 fuzz（随机抖动）让间隔可预测、可复现，方便测试和验证增长。
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

// 为一条新笔记创建初始复习卡片（state=New，due=当前时间）
function createCard() {
  return createEmptyCard();
}

// 根据本次评分更新卡片，返回更新后的卡片。
// rating 用 Rating.Again / Rating.Hard / Rating.Good / Rating.Easy。
// now 可选：本次复习时间，默认当前时间；测试时可传卡片到期日来模拟时间流逝。
function reviewCard(card, rating, now = new Date()) {
  return scheduler.next(card, now, rating).card;
}

// 卡片是否已到期（due 不晚于当前时间，即今天或已过期都算该复习）
function isDue(card) {
  if (!card || !card.due) return false;
  return new Date(card.due).getTime() <= Date.now();
}

// 从一堆卡片里筛出到期的
function getDueCards(cards) {
  return cards.filter(isDue);
}

module.exports = {
  createCard,
  reviewCard,
  isDue,
  getDueCards,
  Rating
};
