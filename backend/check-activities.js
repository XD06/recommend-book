// 书库操作流水（book_activities）的离线验证（零 token、确定性）
//
// 用法：cd backend && npm run build && node check-activities.js
// 在 .eval-run/activities-check/ 下起一个全新空库来跑，不碰你的真实书库。
//
// 覆盖三件事：
//   1. 整库保存的 diff —— 新增/删除/开始读/读完四类事件，以及"不该记的别记"
//   2. 流水的读写 —— 排序、limit 收敛、跨用户隔离、书删除后书名仍在
//   3. 存量回填 —— 按类型补齐、幂等、时间取书里的真实日期
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = __dirname;
const RUN_DIR = path.join(BACKEND, '.eval-run', 'activities-check');

fs.rmSync(RUN_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(RUN_DIR, 'data'), { recursive: true });
process.chdir(RUN_DIR);

const database = require(path.join(BACKEND, 'dist', 'db', 'database.js'));
const { recordLibraryDiff } = require(path.join(BACKEND, 'dist', 'routes', 'books.js'));

const raw = database.default;
database.initDatabase();

const {
  addActivity,
  addActivities,
  listActivities,
  backfillActivities,
} = database;

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(same, same ? label : `${label} —— 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

const uid = 'act-test-user';
const uid2 = 'act-test-user-2';
const insUser = raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)');
insUser.run(uid, 'acttest', 'act@test.local', 'x');
insUser.run(uid2, 'acttest2', 'act2@test.local', 'x');

/** 造一本书的最小参数（走真实 upsert，保证 books 表结构与线上一致） */
const upsert = raw.prepare(database.UPSERT_BOOK_SQL);
function putBook(userId, book) {
  upsert.run(
    database.bookToParams(userId, {
      id: book.id,
      title: book.title,
      author: book.author || '某作者',
      category: book.category || '未分类',
      subcategory: 'General',
      level: 'Basic',
      status: book.status || 'unread',
      userData: book.userData,
      createdAt: book.createdAt || new Date().toISOString(),
    }),
  );
}

const snap = (rows) => new Map(rows.map((b) => [b.id, { title: b.title, status: b.status }]));
const types = (acts) => acts.map((a) => a.type);
const clear = (userId) => raw.prepare('DELETE FROM book_activities WHERE user_id = ?').run(userId);

// ============================================================================
console.log('\n=== 1. 整库保存的 diff ===\n');
// ============================================================================

putBook(uid, { id: 'b1', title: '代码大全', status: 'unread', createdAt: '2026-01-01T00:00:00.000Z' });
putBook(uid, { id: 'b2', title: '人类简史', status: 'reading', createdAt: '2026-01-02T00:00:00.000Z' });
putBook(uid, { id: 'b3', title: '深入理解计算机系统', status: 'finished', createdAt: '2026-01-03T00:00:00.000Z' });

// 基线：三本书都在，谁也没动
recordLibraryDiff(
  uid,
  snap([
    { id: 'b1', title: '代码大全', status: 'unread' },
    { id: 'b2', title: '人类简史', status: 'reading' },
    { id: 'b3', title: '深入理解计算机系统', status: 'finished' },
  ]),
  [
    { id: 'b1', title: '代码大全', status: 'unread' },
    { id: 'b2', title: '人类简史', status: 'reading' },
    { id: 'b3', title: '深入理解计算机系统', status: 'finished' },
  ],
);
eq(listActivities(uid).length, 0, '没有任何变化时一条动态都不记');

// 一次保存里同时发生四种变化：新增 / 删除 / 开始读 / 读完
recordLibraryDiff(
  uid,
  snap([
    { id: 'b1', title: '代码大全', status: 'unread' },
    { id: 'b2', title: '人类简史', status: 'reading' },
    { id: 'b3', title: '深入理解计算机系统', status: 'finished' },
  ]),
  [
    { id: 'b1', title: '代码大全', status: 'reading' },      // 开始读
    { id: 'b2', title: '人类简史', status: 'finished' },     // 读完
    // b3 被删除
    { id: 'b4', title: '【新】心流', status: 'unread' },     // 新增
  ],
);

const diffActs = listActivities(uid, 50);
const byType = (t) => diffActs.filter((a) => a.type === t);
eq(byType('added').map((a) => a.bookTitle), ['【新】心流'], '新增的书记为 added');
eq(byType('deleted').map((a) => a.bookTitle), ['深入理解计算机系统'], '删除的书记为 deleted');
eq(byType('started').map((a) => a.bookTitle), ['代码大全'], 'unread → reading 记为 started');
eq(byType('finished').map((a) => a.bookTitle), ['人类简史'], 'reading → finished 记为 finished');
eq(diffActs.length, 4, '一次保存只记这四类事件，不多不少');

// 删除事件的书名必须来自旧快照 —— 新载荷里已经没有这本书了
const delAct = byType('deleted')[0];
eq(delAct.bookTitle, '深入理解计算机系统', '删除动态的书名取自旧快照（新载荷里已无此书）');

// 不该记的别记
clear(uid);
recordLibraryDiff(
  uid,
  snap([{ id: 'b1', title: '代码大全', status: 'reading' }]),
  [{ id: 'b1', title: '代码大全（第2版）', status: 'reading' }],
);
eq(listActivities(uid).length, 0, '改书名不产生动态（动态不是审计日志）');

clear(uid);
recordLibraryDiff(
  uid,
  snap([{ id: 'b1', title: '代码大全', status: 'reading' }]),
  [{ id: 'b1', title: '代码大全', status: 'unread' }],
);
eq(listActivities(uid).length, 0, 'reading → unread（撤销）不产生动态');

clear(uid);
recordLibraryDiff(
  uid,
  snap([{ id: 'b1', title: '代码大全', status: 'finished' }]),
  [{ id: 'b1', title: '代码大全', status: 'unread' }],
);
eq(listActivities(uid).length, 0, 'finished → unread 也不产生动态');

// 同一状态重复保存（前端防抖会反复推全量）不应刷屏。
// 注意要模拟真实调用：before 每次都从**数据库当前值**读，
// 而不是复用第一次的快照——否则等于把"同一个变化"重放三遍。
// after 也必须带上书库里所有书（少传的会被正确判成"删除"，那是另一条规则）。
clear(uid);
raw.prepare("UPDATE books SET status = 'unread' WHERE id = 'b1'").run();
const readRows = () =>
  raw.prepare('SELECT id, title, status FROM books WHERE user_id = ?').all(uid);
for (let i = 0; i < 3; i++) {
  const before = new Map(readRows().map((r) => [r.id, { title: r.title, status: r.status }]));
  const after = readRows().map((r) =>
    r.id === 'b1' ? { id: r.id, title: r.title, status: 'reading' } : { id: r.id, title: r.title, status: r.status },
  );
  recordLibraryDiff(uid, before, after);
  raw.prepare("UPDATE books SET status = 'reading' WHERE id = 'b1'").run();
}
eq(listActivities(uid).length, 1, '重复保存同一变化不会重复记（第二次起 before 已是 reading，diff 为空）');

// ============================================================================
console.log('\n=== 2. 流水的读写 ===\n');
// ============================================================================

clear(uid);
addActivity(uid, 'b1', '第一本', 'added', '2026-01-01T00:00:00.000Z');
addActivity(uid, 'b2', '第二本', 'started', '2026-01-02T00:00:00.000Z');
addActivity(uid, null, '已删除的书', 'deleted', '2026-01-03T00:00:00.000Z');

const listed = listActivities(uid);
eq(listed.map((a) => a.bookTitle), ['已删除的书', '第二本', '第一本'], '按时间倒序返回');
eq(listed[0].bookId, null, 'bookId 可为 null（书已删除，行已不存在）');
eq(listed[0].bookTitle, '已删除的书', 'bookId 为 null 时书名仍然完整');

addActivities(uid, [
  { bookId: 'b3', bookTitle: '批量一', type: 'added', createdAt: '2026-01-04T00:00:00.000Z' },
  { bookId: 'b4', bookTitle: '批量二', type: 'added', createdAt: '2026-01-05T00:00:00.000Z' },
]);
eq(listActivities(uid, 2).map((a) => a.bookTitle), ['批量二', '批量一'], 'limit 生效且仍是倒序');
eq(addActivities(uid, []), undefined, '空数组不报错');

eq(listActivities(uid, 0).length, 0, 'limit=0 时返回空（不会被当成"不限"）');
eq(listActivities(uid2).length, 0, '跨用户隔离：别人的动态读不到');

// 书被删掉之后，动态仍然可读 —— 这正是独立成表、冗余存书名的原因
raw.prepare('DELETE FROM books WHERE id = ?').run('b1');
const afterBookGone = listActivities(uid).find((a) => a.bookTitle === '第一本');
ok(!!afterBookGone, '书被删除后，它的历史动态仍然存在');

// ============================================================================
console.log('\n=== 3. 存量回填 ===\n');
// ============================================================================

// 造一个"老用户"：书都在，但一条动态也没有
putBook(uid2, {
  id: 'o1', title: '七月的在读', status: 'reading',
  userData: { totalPages: 300, currentPage: 30, progressPercentage: 10, startDate: '2026-07-10' },
  createdAt: '2026-06-01T00:00:00.000Z',
});
putBook(uid2, {
  id: 'o2', title: '八月的读完', status: 'finished',
  userData: { totalPages: 200, currentPage: 200, progressPercentage: 100, completionDate: '2026-08-09' },
  createdAt: '2026-06-02T00:00:00.000Z',
});
putBook(uid2, {
  id: 'o3', title: '从没打开过', status: 'unread',
  createdAt: '2026-06-03T00:00:00.000Z',
});

const n1 = backfillActivities(uid2);
// 3 本 added（三本都有）+ 1 条 started + 1 条 finished = 5
eq(n1, 5, '首次回填补齐 3 条 added + 1 条 started + 1 条 finished');

const backfilled = listActivities(uid2, 50);
eq(
  backfilled.filter((a) => a.type === 'added').map((a) => a.bookTitle).sort(),
  ['七月的在读', '八月的读完', '从没打开过'].sort(),
  '每本书都补了一条 added',
);
eq(
  backfilled.filter((a) => a.type === 'started').map((a) => a.bookTitle),
  ['七月的在读'],
  '在读的书补 started',
);
eq(
  backfilled.filter((a) => a.type === 'finished').map((a) => a.bookTitle),
  ['八月的读完'],
  '读完的书补 finished',
);

// 时间必须取书里的真实日期，不能是 now() —— 否则 7 月的书会显示成"今天读完"
const startedAt = backfilled.find((a) => a.type === 'started').createdAt;
const finishedAt = backfilled.find((a) => a.type === 'finished').createdAt;
ok(startedAt.startsWith('2026-07-10'), `started 用书的真实 startDate（实际 ${startedAt}）`);
ok(finishedAt.startsWith('2026-08-09'), `finished 用书的真实 completionDate（实际 ${finishedAt}）`);
const addedO1 = backfilled.find((a) => a.type === 'added' && a.bookTitle === '七月的在读');
ok(addedO1.createdAt.startsWith('2026-06-01'), 'added 用书的真实 created_at，不是回填当刻');

// 幂等
eq(backfillActivities(uid2), 0, '再次回填返回 0（不重复写）');
eq(listActivities(uid2, 200).length, 5, '再次回填后动态条数不变（仍是 5）');

// 按类型补齐：只缺 started 时，added 不能再来一遍
raw.prepare("DELETE FROM book_activities WHERE user_id = ? AND type = 'started'").run(uid2);
const n2 = backfillActivities(uid2);
eq(n2, 1, '只补缺失的那一类（started 被删后只补回 1 条）');
eq(
  listActivities(uid2, 200).filter((a) => a.type === 'added').length,
  3,
  'added 没有被重复补（按类型判缺失，而不是"表非空就整体跳过"）',
);

// 空书库不炸
eq(backfillActivities('no-such-user'), 0, '没有书的用户回填返回 0');

// ============================================================================
console.log(`\n全部通过：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
