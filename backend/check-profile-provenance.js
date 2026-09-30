// 画像来源与"不得覆盖用户填写"规则的离线验证（零 token、确定性）
//
// 用法：cd backend && npm run build && node check-profile-provenance.js
// 它在 .eval-run/provenance-check/ 下起一个全新空库来跑（database.ts 用 process.cwd()/data），
// 所以不会碰到你的真实书库。
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = __dirname;
const RUN_DIR = path.join(BACKEND, '.eval-run', 'provenance-check');

// 必须先建目录并切 cwd，再 require —— 数据库路径在模块加载时就定了
fs.rmSync(RUN_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(RUN_DIR, 'data'), { recursive: true });
process.chdir(RUN_DIR);

const database = require(path.join(BACKEND, 'dist', 'db', 'database.js'));
const raw = database.default;
const { updateUserProfileInDb, loadUserProfile, loadProfileFieldMeta, listProfileWriteLog, undoProfileWrite } = database;

// 建表语句在 initDatabase() 里（生产环境由 index.ts 启动时调用），这里得自己喊一次
database.initDatabase();

const uid = 'provenance-test-user';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
  .run(uid, 'provenance', 'p@test.local', 'x');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

console.log('=== 画像来源与覆盖保护 ===');

// 1. 用户填写 → 记为 user/form
updateUserProfileInDb(uid, { readingGoal: '打牢统计学基础', dailyReadingTime: 40 }, { source: 'user', via: 'form' });
let meta = loadProfileFieldMeta(uid);
check('用户填写记为 user/form', meta.readingGoal?.source === 'user' && meta.readingGoal?.via === 'form',
  meta.readingGoal);

// 2. AI 推测不得覆盖用户填的目标
let r = updateUserProfileInDb(uid, { readingGoal: '做因果推断研究' }, { source: 'ai', evidence: '从书库推断' });
check('AI 覆盖用户填的字段被拒绝', r.refused.length === 1 && r.written.length === 0, r);
check('被拒后原值不变', loadUserProfile(uid).readingGoal === '打牢统计学基础');

// 3. AI 可以填空白字段，且必须留依据
r = updateUserProfileInDb(uid, { readingLevel: 'advanced' }, { source: 'ai', evidence: '用户提到在读 CSAPP' });
meta = loadProfileFieldMeta(uid);
check('AI 可填空白字段', r.written.includes('readingLevel') && meta.readingLevel?.source === 'ai', r.written);
check('AI 写入保留依据（用户原话）', meta.readingLevel?.evidence === '用户提到在读 CSAPP', meta.readingLevel);

// 4. AI 可以修正自己写过的字段
r = updateUserProfileInDb(uid, { readingLevel: 'intermediate' }, { source: 'ai', evidence: '用户后来改口' });
check('AI 可修正自己写过的字段', loadUserProfile(uid).readingLevel === 'intermediate' && r.refused.length === 0);

// 5. 同值写入不改变来源、不刷掉依据
r = updateUserProfileInDb(uid, { readingLevel: 'intermediate' }, { source: 'ai', evidence: '重复上报' });
check('同值不重写（依据保留、无写入）',
  loadProfileFieldMeta(uid).readingLevel?.evidence === '用户后来改口' && r.written.length === 0, r);

// 6. 用户在对话里明确要求改 → 允许，来源仍是 user（via=conversation）
r = updateUserProfileInDb(uid, { readingGoal: '转向因果推断' }, { source: 'user', via: 'conversation', evidence: '我想改成因果推断' });
meta = loadProfileFieldMeta(uid);
check('用户对话中明说可改自己的字段',
  loadUserProfile(uid).readingGoal === '转向因果推断' && meta.readingGoal?.via === 'conversation', meta.readingGoal);

// 7. 改成 user 之后，AI 再次不得覆盖
r = updateUserProfileInDb(uid, { readingGoal: 'AI 猜的目标' }, { source: 'ai', evidence: 'x' });
check('对话陈述之后 AI 仍不得覆盖', r.refused.length === 1 && loadUserProfile(uid).readingGoal === '转向因果推断');

// 8. 数组字段：顺序不同视为同值，既不误拒也不重写
updateUserProfileInDb(uid, { preferredCategories: ['心理学', '计算机科学'] }, { source: 'user', via: 'form' });
r = updateUserProfileInDb(uid, { preferredCategories: ['计算机科学', '心理学'] }, { source: 'ai', evidence: 'x' });
check('数组顺序不同视为同值', r.refused.length === 0 && r.written.length === 0, r);
r = updateUserProfileInDb(uid, { preferredCategories: ['心理学'] }, { source: 'ai', evidence: 'x' });
check('数组内容不同仍被拒绝', r.refused.length === 1);

// 9. aiAnalysis 不由用户填写，照常写入且不产生来源记录
r = updateUserProfileInDb(uid, {
  aiAnalysis: { inferredLevel: 'advanced', readingPattern: 'p', blindSpots: [], recommendedFocus: 'f', lastUpdated: 'now' },
}, { source: 'ai' });
check('aiAnalysis 正常写入、无来源记录',
  r.written.includes('aiAnalysis') && loadProfileFieldMeta(uid).aiAnalysis === undefined, r.written);

// 10. fieldMeta 随 loadUserProfile 一起返回（注入层与工具层都靠它）
check('loadUserProfile 带出 fieldMeta', !!loadUserProfile(uid).fieldMeta?.readingGoal);

// 11. 同值但来源升级：用户把 AI 记录的字段在设置页原样保存 → 来源变 user（用户确认过）
//     readingLevel 此刻是 ai/intermediate
r = updateUserProfileInDb(uid, { readingLevel: 'intermediate' }, { source: 'user', via: 'form' });
check('同值但来源升级为 user（用户确认）',
  r.written.includes('readingLevel') && loadProfileFieldMeta(uid).readingLevel?.source === 'user', r.written);

// 12. 升级之后 AI 再改就被拒（确认过的字段受保护）
r = updateUserProfileInDb(uid, { readingLevel: 'expert' }, { source: 'ai', evidence: 'x' });
check('用户确认后 AI 不得再覆盖', r.refused.length === 1 && loadUserProfile(uid).readingLevel === 'intermediate');

// ============================================================================
// 写入日志与撤销（用第二个用户，互不干扰）
// ============================================================================
console.log('\n=== 写入日志与撤销 ===');

const uid2 = 'provenance-test-user-2';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
  .run(uid2, 'provenance2', 'p2@test.local', 'x');

// 13. 第一次写入 → 日志 prevValue 为 null
updateUserProfileInDb(uid2, { readingGoal: 'A' }, { source: 'user', via: 'form' });
let logs = listProfileWriteLog(uid2);
check('写入产生一条日志（prev=null）', logs.length === 1 && logs[0].field === 'readingGoal' && logs[0].prevValue === null, logs[0]);
check('日志带来源与触发路径', logs[0].source === 'user' && logs[0].via === 'form' && logs[0].origin === 'form', logs[0]);

// 14. AI 抽取写入也进日志，并保留依据
updateUserProfileInDb(uid2, { dailyReadingTime: 30 }, { source: 'ai', evidence: '每天半小时', origin: 'extract' });
logs = listProfileWriteLog(uid2);
check('AI 抽取写入进日志且带依据',
  logs[0].field === 'dailyReadingTime' && logs[0].origin === 'extract' && logs[0].evidence === '每天半小时', logs[0]);

// 15. 撤销 AI 那次 → 值消失、来源行也消失（回到"从未写过"这一档）
let u = undoProfileWrite(uid2, logs[0].id);
check('撤销成功', u.restored === true && u.field === 'dailyReadingTime', u);
check('撤销后值被清掉', loadUserProfile(uid2).dailyReadingTime === undefined);
check('撤销后来源行也被删掉（回到默认值档）', loadProfileFieldMeta(uid2).dailyReadingTime === undefined);

// 16. 重复撤销被拒
u = undoProfileWrite(uid2, logs[0].id);
check('重复撤销被拒', u.restored === false && !!u.error, u);

// 17. 被拒绝的写入不产生日志（否则"历史"里会出现没发生的改动）
const logCountBefore = listProfileWriteLog(uid2).length;
updateUserProfileInDb(uid2, { readingGoal: 'AI 猜的' }, { source: 'ai', evidence: 'x' });
check('被拒的写入不产生日志', listProfileWriteLog(uid2).length === logCountBefore);

// 18. 改值后撤销 → 还原成"上一个值"，而不是清空
updateUserProfileInDb(uid2, { readingGoal: 'B' }, { source: 'user', via: 'form' });
const goalLog = listProfileWriteLog(uid2)[0];
check('日志带改前的值', goalLog.prevValue === 'A' && goalLog.nextValue === 'B', goalLog);
undoProfileWrite(uid2, goalLog.id);
check('撤销还原成上一个值', loadUserProfile(uid2).readingGoal === 'A');
check('来源也随之还原', loadProfileFieldMeta(uid2).readingGoal?.source === 'user');

// 19. readingLevel 撤销不能把 NOT NULL 列写成 NULL → 回到默认值且无来源行
updateUserProfileInDb(uid2, { readingLevel: 'advanced' }, { source: 'ai', evidence: 'x' });
undoProfileWrite(uid2, listProfileWriteLog(uid2)[0].id);
check('readingLevel 撤销回到默认值且无来源行',
  loadUserProfile(uid2).readingLevel === 'beginner' && loadProfileFieldMeta(uid2).readingLevel === undefined,
  { level: loadUserProfile(uid2).readingLevel, meta: loadProfileFieldMeta(uid2).readingLevel });

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
