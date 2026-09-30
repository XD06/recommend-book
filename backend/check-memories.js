// 长期记忆的离线验证（零 token、确定性）——逐条对应路线图 §16.5 的验收标准
//
// 用法：cd backend && npm run build && node check-memories.js
// 在 .eval-run/memory-check/ 下起一个全新空库来跑，不碰你的真实书库。
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = __dirname;
const RUN_DIR = path.join(BACKEND, '.eval-run', 'memory-check');

fs.rmSync(RUN_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(RUN_DIR, 'data'), { recursive: true });
process.chdir(RUN_DIR);

const database = require(path.join(BACKEND, 'dist', 'db', 'database.js'));
const libraryTools = require(path.join(BACKEND, 'dist', 'services', 'libraryTools.js'));
const raw = database.default;
database.initDatabase();

const {
  addMemory, listMemories, rejectMemory, restoreMemory, selectRelevantMemories, getMemory, MAX_ACTIVE_MEMORIES,
} = database;

const uid = 'memory-test-user';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
  .run(uid, 'memtest', 'm@test.local', 'x');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

console.log('=== 长期记忆 ===');

// ---------------------------------------------------------------- 基本写入与检索
const a = addMemory(uid, { kind: 'constraint', content: '不看成功学类书籍', evidence: '我不看成功学', source: 'user', origin: 'explicit' });
check('写入一条记忆', a.added === true && a.memory?.id > 0, a);
check('列表能查到', listMemories(uid).some((m) => m.content === '不看成功学类书籍'));
check('检索命中（query 与内容重叠）', selectRelevantMemories(uid, '给我推荐几本成功学的书', 3).length === 1);
// constraint 是**有意**"即使与问题字面无关也要带上"的（踩到用户明说过的禁忌，代价比漏掉一条偏好高得多），
// 所以这里断言的是"它被带上"。普通偏好无关不注入，由下面 uid3 那组证明。
check('禁忌类与 query 字面无关时仍注入（有意策略）', selectRelevantMemories(uid, '今天天气怎么样', 3).length === 1);

// 普通偏好：无关不注入、相关才注入
const uid3 = 'memory-relevance-user';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(uid3, 'memrel', 'mr@test.local', 'x');
addMemory(uid3, { kind: 'preference', content: '喜欢非虚构类作品', evidence: '我爱看非虚构', source: 'user', origin: 'explicit' });
check('无关 query 不注入普通偏好', selectRelevantMemories(uid3, '今天天气怎么样', 3).length === 0);
check('相关 query 注入普通偏好', selectRelevantMemories(uid3, '给我推荐点非虚构的书', 3).length === 1);

// "靠禁忌加权进来"的条目要限流：攒了 5 条禁忌，无关 query 下最多带 2 条，留槽位给相关内容
const uid5 = 'memory-cap-user';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(uid5, 'memcap', 'mc@test.local', 'x');
for (let i = 0; i < 5; i++) {
  addMemory(uid5, { kind: 'constraint', content: `禁忌第 ${i} 条：不看某类书`, evidence: `第 ${i} 条`, source: 'user', origin: 'explicit' });
}
const capped = selectRelevantMemories(uid5, '今天天气怎么样', 3);
check('无关 query 下加权进来的禁忌限流为 2 条', capped.length === 2, capped.map((m) => m.content));

// ---------------------------------------------------------------- 去重（标点/空白不同也算同一条）
const dup = addMemory(uid, { kind: 'constraint', content: '不看成功学类书籍。', evidence: 'x', source: 'ai', origin: 'extract' });
check('同内容（多一个句号）不重复添加', dup.added === false && dup.reason === 'duplicate', dup);

// ---------------------------------------------------------------- 【验收 2】删除是终态
const rejectTarget = listMemories(uid)[0];
check('删除成功', rejectMemory(uid, rejectTarget.id) === true);
check('删除后不在活跃列表', !listMemories(uid).some((m) => m.id === rejectTarget.id));
check('删除后不再被注入', selectRelevantMemories(uid, '推荐几本成功学的书', 3).length === 0);
const revive = addMemory(uid, { kind: 'constraint', content: '不看成功学类书籍', evidence: '我不看成功学', source: 'ai', origin: 'extract' });
check('【验收2】同内容被自动记回时拒绝（永不复活）', revive.added === false && revive.reason === 'rejected_before', revive);
check('删除后可恢复（改主意）', restoreMemory(uid, rejectTarget.id) === true && listMemories(uid).length === 1);
check('恢复后同内容会拦截重复添加', addMemory(uid, { kind: 'fact', content: '不看成功学类书籍', evidence: 'y', source: 'ai', origin: 'extract' }).reason === 'duplicate');

// ---------------------------------------------------------------- 【验收 3】注入上限
rejectMemory(uid, rejectTarget.id);   // 先清场
for (let i = 0; i < 10; i++) {
  addMemory(uid, {
    kind: 'preference',
    content: `喜欢${'统计学因果推断'.slice(0, 3 + (i % 3))}主题的第 ${i} 条读书偏好记录`,
    evidence: `第 ${i} 条原话`,
    source: 'ai', origin: 'extract',
  });
}
const q = '我今年想学统计学和因果推断，帮我排个阅读顺序';
const picked = selectRelevantMemories(uid, q, 3, 500);
const pickedChars = picked.reduce((s, m) => s + m.content.length, 0);
const block = libraryTools.buildMemoryBlock(uid, q);
console.log(`    （实测：选中 ${picked.length} 条、内容合计 ${pickedChars} 字符、注入块 ${block.length} 字符）`);
check('【验收3】注入条数 ≤3', picked.length <= 3, picked.length);
check('【验收3】注入内容合计 <500 字符', pickedChars < 500, pickedChars);
check('注入块非空且带【长期记忆】标题', block.includes('【长期记忆】'));

// ---------------------------------------------------------------- 【验收 4】不与画像互相污染
const profRow = raw.prepare('SELECT reading_level, reading_goal, preferred_categories, daily_reading_time FROM user_profiles WHERE user_id = ?').get(uid);
const fieldMetaCount = raw.prepare('SELECT COUNT(*) n FROM profile_field_meta WHERE user_id = ?').get(uid).n;
// 没有任何画像行也算通过：那更彻底地证明了"记忆不会写画像"
check('【验收4】记忆没有写进 user_profiles 的任何字段',
  !profRow || (!profRow.reading_goal && !profRow.preferred_categories && !profRow.daily_reading_time),
  profRow ?? '(无画像行)');
check('【验收4】记忆没有产生 profile_field_meta 行', fieldMetaCount === 0, fieldMetaCount);

// ---------------------------------------------------------------- 【验收 6】TTL 过期
const past = new Date(Date.now() - 86400000).toISOString();
const evt = addMemory(uid, { kind: 'event', content: '下个月要参加考试', evidence: '我下个月要考试', source: 'user', origin: 'explicit', expiresAt: past });
check('「过期」的事不在活跃列表里', !listMemories(uid).some((m) => m.id === evt.memory.id));
check('「过期」的事不被注入', !selectRelevantMemories(uid, '我下个月要考试了，推荐点轻松的', 3).some((m) => m.id === evt.memory.id));
check('加 includeExpired 才能看到它（便于界面展示历史）',
  listMemories(uid, { includeExpired: true }).some((m) => m.id === evt.memory.id));

// ---------------------------------------------------------------- event 默认 TTL
const evt2 = addMemory(uid, { kind: 'event', content: '下周开始出差', evidence: '下周出差', source: 'ai', origin: 'extract' });
check('event 类没给过期时间时自动给默认寿命', !!evt2.memory?.expiresAt, evt2.memory?.expiresAt);
const ttlDays = (new Date(evt2.memory.expiresAt).getTime() - Date.now()) / 86400000;
check('默认寿命约为 60 天', ttlDays > 55 && ttlDays < 65, Math.round(ttlDays));

// ---------------------------------------------------------------- 上限保护
const uid2 = 'memory-limit-user';
raw.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)').run(uid2, 'memlimit', 'ml@test.local', 'x');
for (let i = 0; i < MAX_ACTIVE_MEMORIES; i++) {
  addMemory(uid2, { kind: 'fact', content: `第 ${i} 条记忆内容`, evidence: 'x', source: 'ai', origin: 'extract' });
}
const over = addMemory(uid2, { kind: 'fact', content: '超出上限的一条', evidence: 'x', source: 'ai', origin: 'extract' });
check(`活跃上限 ${MAX_ACTIVE_MEMORIES} 条生效`, over.added === false && over.reason === 'limit_reached', over.reason);

// ---------------------------------------------------------------- 空内容与 touch
check('空内容被拒', addMemory(uid, { kind: 'fact', content: '   ', evidence: 'x', source: 'ai', origin: 'extract' }).reason === 'empty');

const before = getMemory(uid, picked[0].id).lastUsedAt;
libraryTools.buildMemoryBlock(uid, q);
const after = getMemory(uid, picked[0].id).lastUsedAt;
check('注入会更新 last_used_at（用于让位给别的记忆）', after !== null && after !== before, { before, after });

// ---------------------------------------------------------------- 内容长度封顶
const long = addMemory(uid, { kind: 'fact', content: '很长的内容'.repeat(100), evidence: 'x', source: 'ai', origin: 'extract' });
check('内容被截到 200 字以内', long.memory.content.length <= 200, long.memory.content.length);

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
