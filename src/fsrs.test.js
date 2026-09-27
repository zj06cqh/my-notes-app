// FSRS 算法简单测试：创建卡片 → 连续 Good 评分 3 次，观察 due 与 stability 的增长。
// 运行：node src/fsrs.test.js
const assert = require('assert');
const { createCard, reviewCard, isDue, getDueCards, Rating } = require('./fsrs');

const fmt = (d) => new Date(d).toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;

console.log('=== FSRS 模拟：创建卡片 → 连续 Good 评分 3 次 ===\n');

const cards = [createCard()];
console.log('创建卡片      stability=0            due=' + fmt(cards[0].due));

// 第 1 次 Good：新卡立即复习（仍处于学习阶段，间隔为 0）
cards[1] = reviewCard(cards[0], Rating.Good);
console.log('Good 第 1 次  stability=' + cards[1].stability.toFixed(2) + '      due=' + fmt(cards[1].due) + '  间隔=' + cards[1].scheduled_days + ' 天');

// 第 2 / 3 次 Good：等到到期日再复习（模拟时间流逝）
cards[2] = reviewCard(cards[1], Rating.Good, new Date(cards[1].due));
console.log('Good 第 2 次  stability=' + cards[2].stability.toFixed(2) + '      due=' + fmt(cards[2].due) + '  间隔=' + cards[2].scheduled_days + ' 天');

cards[3] = reviewCard(cards[2], Rating.Good, new Date(cards[2].due));
console.log('Good 第 3 次  stability=' + cards[3].stability.toFixed(2) + '      due=' + fmt(cards[3].due) + '  间隔=' + cards[3].scheduled_days + ' 天');

console.log('\n=== 验证 ===');
// 间隔（scheduled_days）应持续拉长
assert.ok(cards[3].scheduled_days > cards[2].scheduled_days, '间隔应持续拉长');
assert.ok(cards[2].scheduled_days > cards[1].scheduled_days, '间隔应持续拉长');
// stability（记忆稳定性）整体应增长
assert.ok(cards[3].stability > cards[1].stability, 'stability 应整体增长');
// due 日期应越来越靠后
assert.ok(cards[3].due > cards[2].due && cards[2].due > cards[1].due, 'due 日期应越来越靠后');

console.log('✓ 间隔持续拉长：' + cards[1].scheduled_days + ' → ' + cards[2].scheduled_days + ' → ' + cards[3].scheduled_days + ' 天');
console.log('✓ stability 增长：' + cards[1].stability.toFixed(2) + ' → ' + cards[2].stability.toFixed(2) + ' → ' + cards[3].stability.toFixed(2));
console.log('✓ due 日期后移：' + fmt(cards[1].due) + ' → ' + fmt(cards[2].due) + ' → ' + fmt(cards[3].due));

// 顺带冒烟测试 isDue / getDueCards
const now = Date.now();
const dueNow = { due: new Date(now) };
const dueLater = { due: new Date(now + DAY) };
assert.ok(isDue(dueNow) === true, '到期卡应判为需复习');
assert.ok(isDue(dueLater) === false, '未到期卡应判为不需复习');
assert.strictEqual(getDueCards([dueNow, dueLater]).length, 1, '应只筛出到期的 1 张');
console.log('✓ isDue / getDueCards 冒烟通过');

console.log('\n测试通过 ✓');
