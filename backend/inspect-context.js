#!/usr/bin/env node
/**
 * 上下文体检 —— "这次请求到底往模型里塞了什么"
 *
 * 用法（零 token，不联网）：
 *   cd backend && npm run build
 *   node inspect-context.js
 *   node inspect-context.js --query="我想系统学认知心理学" --user=admin
 *
 * 它按 AGENTS 的三点隔离跑：VACUUM INTO 快照到 backend/.eval-run/inspect/ 并切 cwd，
 * 所以只读你的库、不改它、也不会和 :3001 的实例抢锁。
 *
 * 关键点：提示词由 aiService 的 buildAdvisorPrompt() 组装，本脚本直接调它，
 * 因此这里报的字符数与真实请求逐字一致（不是另写一份估算逻辑）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = {};
for (const raw of process.argv.slice(2)) {
  const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const BACKEND = __dirname;
const RUN_DIR = path.join(BACKEND, '.eval-run', 'inspect');
const QUERY = String(args.query || '我想系统学一下认知心理学，书架上哪些能接着读？');

// 先加载 .env：EXA_API_KEY 决定联网工具是否挂给模型（工具数 10 vs 12），
// 不加载就会报出一个与线上不符的工具清单
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env') });

// ---------------------------------------------------------------- 隔离：先快照 + 切 cwd，再 require
const Database = require(path.join(BACKEND, 'node_modules', 'better-sqlite3'));
{
  const src = path.join(BACKEND, 'data', 'deepread.db');
  if (!fs.existsSync(src)) {
    console.error('找不到 backend/data/deepread.db');
    process.exit(1);
  }
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(RUN_DIR, 'data'), { recursive: true });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  db.prepare('VACUUM INTO ?').run(path.join(RUN_DIR, 'data', 'deepread.db'));
  db.close();
}
process.chdir(RUN_DIR);

const dist = (p) => require(path.join(BACKEND, 'dist', p));
const { createAgentContext, getAllTools, isWriteTool, isLibraryCatalogTool, FULL_INDEX_LIMIT } = dist('services/libraryTools.js');
const aiService = dist('services/aiService.js');
const { READING_ADVISOR_SYSTEM_PROMPT } = dist('prompts/index.js');

// 选用户
const dbModule = dist('db/database.js');
// 快照来自真实库，可能还没有新加的表（真实库要等后端下次启动跑 CREATE TABLE IF NOT EXISTS）。
// 这里补一次初始化，模拟后端启动后的状态 —— 顺带证明"加新表不需要迁移"。
dbModule.initDatabase();
const raw = dbModule.default;
const users = raw.prepare(`
  SELECT u.id, u.username, COUNT(b.id) n FROM users u LEFT JOIN books b ON b.user_id = u.id
  GROUP BY u.id ORDER BY n DESC
`).all();
const user = args.user ? users.find((u) => u.username === args.user) : users[0];
if (!user) { console.error('找不到用户'); process.exit(1); }

const ctx = createAgentContext(user.id);
const { systemPrompt, userPrompt } = aiService.buildAdvisorPrompt(ctx, { userRequest: QUERY });
const tools = getAllTools();

const line = (c = '─') => console.log(c.repeat(78));
const pct = (n, total) => `${((n / total) * 100).toFixed(0)}%`;
const estTokens = (s) => Math.round(s.length / 1.6);   // 中文粗估：1 token ≈ 1.6 字符

console.log(`\n上下文体检  user=${user.username}（${user.n} 本）  查询="${QUERY}"`);
line('═');

// ---------------------------------------------------------------- 1. 注入了什么
const tier = user.n <= FULL_INDEX_LIMIT ? `完整索引（≤${FULL_INDEX_LIMIT} 本，含全部 [id] 书名）`
  : user.n <= 300 ? '节选（全部在读 + 最近读完 + 各分类最新 3 本）'
  : '不注入书名（>300 本，模型必须靠工具把书捞出来）';
console.log(`\n① 书库注入档位：${tier}`);

const gates = [];
gates.push(`书库硬闸门 requireLibraryTool = ${ctx.library.length > FULL_INDEX_LIMIT}` +
  `（${ctx.library.length > FULL_INDEX_LIMIT ? '声称推了书架上的书却没查工具 → 追加 1 轮' : '概览里就是全量书名，不需要'}）`);
gates.push(`画像落盘闸门 requireProfileWrite = ${aiService.hasStableProfileStatement(QUERY)}` +
  `（本次查询${aiService.hasStableProfileStatement(QUERY) ? '命中' : '未命中'}"稳定画像自述"正则）`);
gates.push('模式闸门 = 常开（尾部指令：寒暄/笼统 → conversation，不给书单）');
console.log(`② 闸门状态：\n   - ${gates.join('\n   - ')}`);

// ---------------------------------------------------------------- 2. 提示词分段
const totalChars = systemPrompt.length + userPrompt.length + JSON.stringify(tools).length;
console.log(`\n③ 提示词总量`);
console.log(`   system       ${String(systemPrompt.length).padStart(6)} 字符  (≈${estTokens(systemPrompt)} tok)  ${pct(systemPrompt.length, totalChars)}`);
console.log(`     其中原始模板 ${String(READING_ADVISOR_SYSTEM_PROMPT.length).padStart(6)} 字符，withTools 附加 ${String(systemPrompt.length - READING_ADVISOR_SYSTEM_PROMPT.length).padStart(5)} 字符（工具说明 + 使用准则 + 轮次说明）`);
console.log(`   user         ${String(userPrompt.length).padStart(6)} 字符  (≈${estTokens(userPrompt)} tok)  ${pct(userPrompt.length, totalChars)}`);
console.log(`   tools schema ${String(JSON.stringify(tools).length).padStart(6)} 字符  (≈${estTokens(JSON.stringify(tools))} tok)  ${pct(JSON.stringify(tools).length, totalChars)}`);
console.log(`   ${'─'.repeat(40)}`);
console.log(`   合计         ${String(totalChars).padStart(6)} 字符  (≈${Math.round(totalChars / 1.6)} tok 粗估，中文按 1.6 字符/token)`);

console.log(`\n④ user prompt 逐段（按【】切分，段落顺序即拼装顺序）`);
const segments = userPrompt.split(/(?=【)/).filter((s) => s.trim());
for (const seg of segments) {
  const head = seg.split('\n')[0].slice(0, 34);
  const body = seg.slice(seg.indexOf('\n') + 1).split('\n').filter(Boolean);
  console.log(`   ${String(seg.length).padStart(6)} 字符  ${head}${body.length > 1 ? `（${body.length} 行）` : ''}`);
}

// ---------------------------------------------------------------- 3. 画像四档实况
console.log(`\n⑤ 画像注入实况（四档 → 见 buildProfileBlock）`);
const prof = ctx.userProfile;
console.log(`   isProfileConfigured = ${dist('services/libraryTools.js').isProfileConfigured(prof)}`);
if (prof) {
  console.log(`   fieldMeta 条目：${Object.keys(prof.fieldMeta || {}).length} 个 → ${JSON.stringify(prof.fieldMeta || {})}`);
}
const profSeg = segments.find((s) => s.startsWith('【用户画像】'));
console.log(`   注入文本：\n${(profSeg || '（未设置，注入"未设置，可以问"）').split('\n').map((l) => '     ' + l).join('\n')}`);

// ---------------------------------------------------------------- 4. 工具
console.log(`\n⑥ 挂给模型的工具（${tools.length} 个）`);
const kind = (name) => isWriteTool(name) ? '写' : '读';
const cat = (name) => isLibraryCatalogTool(name) ? '书目' : '其他';
for (const t of tools) {
  const n = t.function.name;
  console.log(`   [${kind(n)}/${cat(n)}] ${n.padEnd(26)} ${String(t.function.description || '').slice(0, 46)}`);
}
console.log(`   注：书目类工具才是"这次算不算真查过书库"的判据；画像类不算，否则一次 get_user_profile 就能蒙过硬闸门。`);

// ---------------------------------------------------------------- 5. 上下文之外会额外进 messages 的东西
console.log(`\n⑦ 除提示词外还会进入 messages 的内容`);
console.log(`   对话历史：调用方传 conversationHistory 时按 MAX_CONVERSATION_MESSAGES=${process.env.MAX_CONVERSATION_MESSAGES || 40} 条 / ${process.env.MAX_CONVERSATION_TOKENS || 12000} token 裁剪后注入`);
console.log(`   工具结果：Phase 1 每轮把 tool 结果按原顺序追加（search_library 默认 15 条/次）`);
console.log(`\n（本次体检零 token、零联网；快照在 ${RUN_DIR}）\n`);
