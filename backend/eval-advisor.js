#!/usr/bin/env node
/**
 * DeepRead AI 荐书评估台 —— 隔离运行 + 前后对比
 *
 * ⚠️ 会消耗真实 LLM token 与 Exa web 额度：不传 --run 只会打印用法，不会发请求。
 *
 * 用法：
 *   cd backend && npm run build                       # 评估跑的是 dist/，先构建
 *   node eval-advisor.js --run --tag=baseline --model=step-3.7-flash
 *   node eval-advisor.js --run --tag=after    --model=step-3.7-flash
 *   node eval-advisor.js --compare=baseline,after      # 只做对比，不发请求、不花钱
 *
 * 隔离三件套（照搬 AGENTS.md「要跑真实 AI 路径又不碰用户环境」）：
 *   ① 换库靠换 cwd —— database.ts 用 process.cwd()/data/deepread.db，
 *      所以整个后端进程跑在 backend/.eval-run/<tag>/ 下，库里是 VACUUM INTO 的快照（不用 cp，WAL 会丢）。
 *   ② 换模型靠 env —— getModel() 每次现读 process.env.LITELLM_MODEL，进程内覆盖，backend/.env 不动。
 *   ③ 登录态靠现签 JWT —— 用副本里的用户行 + JWT_SECRET 签一个 30 分钟 token，只在内存里。
 * 用户 :3001 实例可以同时在跑，互不影响（本脚本用 3999）。
 *
 * .eval-run/ 里含用户书库快照与评估结果，已在 .gitignore 中排除，禁止提交。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND = __dirname;
const RUN_ROOT = path.join(BACKEND, '.eval-run');
const mod = (m) => require(path.join(BACKEND, 'node_modules', m));
const Database = mod('better-sqlite3');
const jwt = mod('jsonwebtoken');

// ---------------------------------------------------------------- 参数

const args = {};
for (const raw of process.argv.slice(2)) {
  const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}

const USAGE = `
DeepRead AI 荐书评估台

  node eval-advisor.js --run --tag=<名字> [--model=step-3.7-flash] [--port=3999] [--only=id1,id2] [--user=<username>]
  node eval-advisor.js --compare=<tagA>,<tagB>

  --run        确认执行（会消耗真实 token；缺省只打印本用法）
  --tag        本次结果的名字，结果落在 backend/.eval-run/<tag>/
  --model      覆盖 LITELLM_MODEL（默认 step-3.7-flash）
  --user       用哪个账号的书库做测试（默认取书最多的那个）
  --only       只跑指定 query id，逗号分隔
  --maxms      单次请求超时（默认 240000）
`;

if (!args.run && !args.compare && !args.dry && !args.extract) {
  console.log(USAGE);
  process.exit(0);
}

// ---------------------------------------------------------------- 环境

function loadEnv() {
  const txt = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const fileEnv = loadEnv();

// ---------------------------------------------------------------- 对比模式（在所有定义之后执行，见文件末尾）
const compareArg = args.compare;

// ---------------------------------------------------------------- 工具函数

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickUser() {
  const db = new Database(path.join(BACKEND, 'data', 'deepread.db'), { readonly: true, fileMustExist: true });
  const rows = db.prepare(`
    SELECT u.id, u.username, u.email, COUNT(b.id) n
    FROM users u LEFT JOIN books b ON b.user_id = u.id
    GROUP BY u.id ORDER BY n DESC
  `).all();
  db.close();
  if (rows.length === 0) throw new Error('库里没有用户，无法评估');
  if (args.user) {
    const hit = rows.find((r) => r.username === args.user);
    if (!hit) throw new Error(`找不到用户 ${args.user}`);
    return hit;
  }
  return rows[0];
}

function snapshotDb(destDir) {
  fs.mkdirSync(path.join(destDir, 'data'), { recursive: true });
  const target = path.join(destDir, 'data', 'deepread.db');
  const db = new Database(path.join(BACKEND, 'data', 'deepread.db'), { readonly: true, fileMustExist: true });
  // VACUUM INTO 会把 WAL 里未落盘的部分一起写出去；cp 会丢
  db.prepare('VACUUM INTO ?').run(target);
  db.close();
  return target;
}

async function waitHealthy(port, child, logPath, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`后端提前退出(code=${child.exitCode})，日志:\n${fs.readFileSync(logPath, 'utf8').slice(-2000)}`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(400);
  }
  throw new Error('后端 60s 内未就绪');
}

/** 跑一条推荐请求，解析 SSE，返回结构化结果 */
async function ask(port, token, body, logPath, timeoutMs) {
  const logBefore = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);

  const out = {
    wallMs: 0, tFirstPhaseMs: null, tFirstChunkMs: null,
    phases: [], toolCalls: [], chunks: '', reasoning: '',
    bookUpdates: [], done: null, errors: [], httpStatus: null,
  };

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/recommend/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    out.httpStatus = res.status;
    if (!res.ok) {
      out.errors.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return out;
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop();
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        const now = Date.now() - t0;
        switch (ev.type) {
          case 'phase':
            out.phases.push({ phase: ev.phase, t: now });
            if (out.tFirstPhaseMs === null) out.tFirstPhaseMs = now;
            break;
          case 'tool_call':
            out.toolCalls.push({ tool: ev.tool, label: ev.label, round: ev.round, t: now });
            break;
          case 'chunk':
            if (out.tFirstChunkMs === null) out.tFirstChunkMs = now;
            out.chunks += ev.content || '';
            break;
          case 'reasoning': out.reasoning += ev.content || ''; break;
          case 'book_update': out.bookUpdates.push(ev); break;
          case 'done': out.done = ev.data; break;
          case 'error': out.errors.push(ev.message); break;
        }
      }
    }
  } catch (e) {
    out.errors.push(e.name === 'AbortError' ? `超时 ${timeoutMs}ms` : String(e.message || e));
  } finally {
    clearTimeout(timer);
    out.wallMs = Date.now() - t0;
  }

  // 取本次请求的后端日志增量 —— 轮数、工具参数、校验结果都在里面
  try {
    const buf = fs.readFileSync(logPath);
    out.log = buf.slice(logBefore).toString('utf8');
  } catch { out.log = ''; }
  return out;
}

function summarize(q, ask1) {
  const r = ask1.done || {};
  const libs = r.libraryMatches || [];
  const exts = r.externalMatches || [];
  const rounds = [...String(ask1.log).matchAll(/Agent round (\d+)\/(\d+)/g)].map((m) => Number(m[1]));
  const toolArgs = [...String(ask1.log).matchAll(/执行工具: (\w+) \(args=(.*)\)/g)].map((m) => ({ tool: m[1], args: m[2] }));
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    ok: ask1.errors.length === 0 && !!ask1.done && !ask1.done.__error,
    errors: ask1.errors,
    wallMs: ask1.wallMs,
    tFirstPhaseMs: ask1.tFirstPhaseMs,
    tFirstChunkMs: ask1.tFirstChunkMs,
    mode: r.mode || null,
    libraryMatches: libs.map((m) => ({
      title: m.title, bookId: m.bookId, role: m.role,
      reason: m.reason, timing: m.timing, prerequisite: m.prerequisite ?? null,
      reasonLen: (m.reason || '').length,
      reasonMentionsBook: /《/.test(m.reason || ''),
    })),
    externalMatches: exts.map((e) => ({ title: e.title, author: e.author, role: e.role, confidence: e.confidence, level: e.level, reasonLen: (e.reason || '').length })),
    matchValidation: r.matchValidation || null,
    analysis: r.analysis || null,
    readingInsight: r.readingInsight || null,
    recommendationStrategy: r.recommendationStrategy || null,
    reply: r.reply || null,
    suggestedQuestions: r.suggestedQuestions || [],
    phases: ask1.phases,
    toolCalls: ask1.toolCalls,
    toolArgs,
    rounds: rounds.length ? Math.max(...rounds) : 0,
    roundLog: [...String(ask1.log).matchAll(/Agent round \d+\/\d+[^\n]*/g)].map((m) => m[0]),
    validationLog: [...String(ask1.log).matchAll(/推荐校验:[^\n]*/g)].map((m) => m[0]),
    skippedPhase2: /跳过 Phase 2/.test(String(ask1.log)),
    bookUpdates: ask1.bookUpdates.length,
    // 闸门是否触发
    gateFired: /书库硬闸门/.test(String(ask1.log)),
    rawJsonPreview: (ask1.chunks || '').slice(0, 400),
  };
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const tag = String(args.tag || 'run');
  const model = String(args.model || 'step-3.7-flash');
  const port = Number(args.port || 3999);
  const maxms = Number(args.maxms || 240000);

  const queriesFile = JSON.parse(fs.readFileSync(path.join(BACKEND, 'eval-queries.json'), 'utf8'));
  let singles = queriesFile.queries;
  if (args.only) {
    const want = new Set(String(args.only).split(','));
    singles = singles.filter((q) => want.has(q.id));
  }
  const multi = args.only ? queriesFile.multiTurn.filter((m) => String(args.only).split(',').includes(m.id)) : queriesFile.multiTurn;

  const runDir = path.join(RUN_ROOT, tag);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const logPath = path.join(runDir, 'backend.log');
  fs.writeFileSync(logPath, '');

  const dbPath = snapshotDb(runDir);
  const user = pickUser();
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, fileEnv.JWT_SECRET || 'deepread-dev-secret-change-in-production', { expiresIn: '30m' });

  const distEntry = path.join(BACKEND, 'dist', 'index.js');
  if (!fs.existsSync(distEntry)) throw new Error('缺少 dist/index.js，先在 backend 下 npm run build');

  const env = {
    ...process.env,          // 保留 PATH 等
    ...fileEnv,              // backend/.env 全部变量（不写文件、不改用户配置）
    PORT: String(port),
    LITELLM_MODEL: model,
    NODE_ENV: 'development',
    NODE_USE_ENV_PROXY: '1', // 本机出网靠代理时 Node fetch 必须带这个，否则一律 fetch failed
  };

  const outFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [distEntry], {
    cwd: runDir,                                  // ← 换库就靠这一行
    env,
    stdio: ['ignore', outFd, outFd],               // 沙箱下不能用管道，只能重定向到文件
    windowsHide: true,
  });
  fs.closeSync(outFd);

  console.log(`[eval] tag=${tag} model=${model} port=${port}`);
  console.log(`[eval] 用户=${user.username}（${user.n} 本）  库快照=${dbPath}`);
  console.log(`[eval] 后端日志=${logPath}\n`);

  const results = { tag, model, user: user.username, librarySize: user.n, startedAt: new Date().toISOString(), queries: [], multiTurn: [] };

  try {
    await waitHealthy(port, child, logPath);

    // --dry：只验证隔离管道与新端点的端到端（快照库 / 现签 JWT / 端口），一个 AI 请求都不发
    if (args.dry) {
      const auth = { Authorization: `Bearer ${token}` };
      const h = await fetch(`http://127.0.0.1:${port}/api/books`, { headers: auth });
      const hj = await h.json().catch(() => ({}));
      const p = await fetch(`http://127.0.0.1:${port}/api/profile`, { headers: auth });
      const pj = await p.json().catch(() => ({}));
      console.log(`[dry] GET  /api/books         -> ${h.status}, 本数=${Array.isArray(hj.data) ? hj.data.length : 'N/A'}`);
      console.log(`[dry] GET  /api/profile       -> ${p.status}, readingLevel=${pj?.data?.readingLevel ?? 'N/A'}, goal=${pj?.data?.readingGoal ?? 'null'}, updatedAt=${pj?.data?.updatedAt ?? 'null'}`);

      // P0-2：统计口径拆成豆瓣分与用户自评两套，确认接口形状
      const s = await fetch(`http://127.0.0.1:${port}/api/profile/stats`, { headers: auth });
      const sj = await s.json().catch(() => ({}));
      const r = sj?.data || {};
      console.log(`[dry] GET  /api/profile/stats -> ${s.status}, doubanRating=${JSON.stringify(r.doubanRating)} userRating=${JSON.stringify(r.userRating)} rating字段已移除=${r.rating === undefined}`);

      // P1-2：展示分母 + 采纳率读取端
      const fb = await fetch(`http://127.0.0.1:${port}/api/ai/recommend-feedback`, { headers: auth });
      const fbj = await fb.json().catch(() => ({}));
      console.log(`[dry] GET  /api/ai/recommend-feedback -> ${fb.status}, stats=${JSON.stringify(fbj.stats)}`);

      // P1-1：会话历史 PUT/GET/DELETE 往返
      const turns = [{ userRequest: 'dry-run', result: { mode: 'conversation', reply: 'ok' } }];
      const put = await fetch(`http://127.0.0.1:${port}/api/ai/conversation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ type: 'ai_advisor', messages: turns }),
      });
      const get1 = await fetch(`http://127.0.0.1:${port}/api/ai/conversation?type=ai_advisor`, { headers: auth });
      const g1 = await get1.json().catch(() => ({}));
      const del = await fetch(`http://127.0.0.1:${port}/api/ai/conversation?type=ai_advisor`, { method: 'DELETE', headers: auth });
      const get2 = await fetch(`http://127.0.0.1:${port}/api/ai/conversation?type=ai_advisor`, { headers: auth });
      const g2 = await get2.json().catch(() => ({}));
      console.log(`[dry] PUT  /api/ai/conversation -> ${put.status};  GET 回读 ${Array.isArray(g1?.data?.messages) ? g1.data.messages.length : 0} 轮（应 1）`);
      console.log(`[dry] DEL  /api/ai/conversation -> ${del.status};  GET 回读 ${g2?.data === null ? 'null（已清空）' : JSON.stringify(g2?.data)}`);

      console.log('[dry] 隔离管道 OK，未发起任何 AI 请求');
      return;
    }

    // --extract：只验证"回合后画像抽取"这条路（一次廉价 LLM 调用）
    if (args.extract) {
      const auth = { Authorization: `Bearer ${token}` };
      const msg = String(args.extract);
      const t0 = Date.now();
      const r = await fetch(`http://127.0.0.1:${port}/api/ai/profile/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ userMessage: msg }),
      });
      const j = await r.json().catch(() => ({}));
      console.log(`[extract] POST /api/ai/profile/extract -> ${r.status}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      console.log(`[extract] 用户消息: ${msg}`);
      console.log(`[extract] 响应: ${JSON.stringify(j.data, null, 2)}`);

      // --undo：紧接着把刚才写进去的字段逐条撤销，验证 HTTP 层与还原逻辑
      if (args.undo && Array.isArray(j?.data?.logged) && j.data.logged.length > 0) {
        console.log('\n[extract] 逐条撤销:');
        for (const l of j.data.logged) {
          const ur = await fetch(`http://127.0.0.1:${port}/api/ai/profile/undo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth },
            body: JSON.stringify({ logId: l.logId }),
          });
          const uj = await ur.json().catch(() => ({}));
          console.log(`  - logId=${l.logId} (${l.field}) -> ${ur.status} ${JSON.stringify(uj.data?.field ?? uj.error)}`);
        }
        // 再撤销一次，应被拒
        const again = await fetch(`http://127.0.0.1:${port}/api/ai/profile/undo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify({ logId: j.data.logged[0].logId }),
        });
        console.log(`  - 重复撤销 -> ${again.status}（应 400）`);
      }

      // 直接查快照库：画像行、来源行、写入日志
      const D = new Database(dbPath, { readonly: true, fileMustExist: true });
      console.log('\n[extract] user_profiles:', D.prepare(
        'SELECT reading_level, reading_goal, preferred_categories, daily_reading_time, updated_at FROM user_profiles WHERE user_id = ?',
      ).get(user.id));
      console.log('[extract] profile_field_meta:', D.prepare(
        'SELECT field, source, via, evidence FROM profile_field_meta WHERE user_id = ?',
      ).all(user.id));
      console.log('[extract] profile_write_log:', D.prepare(
        'SELECT id, field, prev_value, next_value, source, origin, evidence, undone_at FROM profile_write_log WHERE user_id = ? ORDER BY id',
      ).all(user.id));
      D.close();
      return;
    }

    console.log('[eval] 后端就绪，开始逐条提问（真实计费）\n');
    for (const q of singles) {
      process.stdout.write(`  · ${q.id} … `);
      const ask1 = await ask(port, token, { userRequest: q.prompt }, logPath, maxms);
      const s = summarize(q, ask1);
      results.queries.push(s);
      console.log(`${s.mode || 'ERR'} ${(s.wallMs / 1000).toFixed(1)}s 库${s.libraryMatches.length} 外${s.externalMatches.length} 轮${s.rounds} 工具${s.toolCalls.length}${s.errors.length ? ' ⚠ ' + s.errors[0].slice(0, 80) : ''}`);
    }

    for (const mt of multi) {
      const history = [];
      const turns = [];
      for (const prompt of mt.turns) {
        process.stdout.write(`  · ${mt.id} (${turns.length + 1}/${mt.turns.length}) … `);
        const ask1 = await ask(port, token, { userRequest: prompt, conversationHistory: history.length ? history : undefined }, logPath, maxms);
        const s = summarize({ id: mt.id, kind: mt.kind, prompt }, ask1);
        turns.push(s);
        const r = ask1.done || {};
        // 与 AIAdvisor 的序列化保持一致，否则测的不是线上路径
        const assistantContent = r.mode === 'conversation'
          ? (r.reply || '')
          : [r.analysis || '', r.recommendationStrategy || '',
             ...(r.libraryMatches || []).map((m) => `书库推荐: 《${m.title || m.bookId}》[id:${m.bookId}] (${m.role || 'unknown'}) - ${m.reason}`),
             ...(r.externalMatches || []).map((e) => `外部推荐: 《${e.title}》-${e.author} (${e.role || 'unknown'}) - ${e.reason}`),
            ].join('\n');
        history.push({ role: 'user', content: prompt }, { role: 'assistant', content: assistantContent });
        console.log(`${s.mode || 'ERR'} ${(s.wallMs / 1000).toFixed(1)}s 库${s.libraryMatches.length}`);
      }
      results.multiTurn.push({ id: mt.id, kind: mt.kind, watchFor: mt.watchFor, turns });
    }
  } finally {
    child.kill();
    await sleep(500);
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`\n[eval] 结果已写入 ${path.join(runDir, 'results.json')}`);
  }

  printSummary(results);
}

// ---------------------------------------------------------------- 输出

function printSummary(r) {
  console.log(`\n=== ${r.tag}｜model=${r.model}｜书库 ${r.librarySize} 本 ===`);
  console.log('id                 mode          match ext  轮  工具   耗时   丢弃  闸门');
  for (const q of r.queries) {
    console.log(
      `${q.id.padEnd(18)} ${String(q.mode || 'ERR').padEnd(13)} ${String(q.libraryMatches.length).padStart(4)} ${String(q.externalMatches.length).padStart(4)} ` +
      `${String(q.rounds).padStart(3)} ${String(q.toolCalls.length).padStart(5)} ${(q.wallMs / 1000).toFixed(1).padStart(6)}s ` +
      `${String(q.matchValidation?.dropped ?? 0).padStart(5)} ${q.gateFired ? '  ✓' : '  -'}`,
    );
  }
  const toolCount = {};
  let totalDropped = 0;
  for (const q of r.queries) {
    for (const t of q.toolCalls) toolCount[t.tool] = (toolCount[t.tool] || 0) + 1;
    totalDropped += q.matchValidation?.dropped ?? 0;
  }
  console.log(`\n工具调用分布: ${JSON.stringify(toolCount)}`);
  console.log(`幻觉丢弃合计: ${totalDropped}`);
  const chatty = r.queries.filter((q) => ['smalltalk', 'vague-request'].includes(q.id));
  console.log(`模式闸门: ${chatty.map((q) => `${q.id}=${q.mode}`).join('  ')}`);
}

/**
 * "假信号词" —— 这些词出现在模型输出里，说明旧数据的人格判决漏到了用户面前：
 * 画像默认值 beginner、豆瓣分被当用户评分、无行为数据却推断阅读人格。
 * 改前改后各数一遍，是最直接的证据。
 */
const FALSE_SIGNALS = [
  // 模型习惯写英文档位名，所以 beginner 必须进来；但要限定"把档位说成用户属性"的句式，
  // 否则"beginner 级书籍"这种中性描述也会被算进去
  { key: '把用户说成 beginner', re: /(你是\s*beginner|作为\s*beginner|自评\s*beginner|beginner\s*水平|初学者水平)/i },
  { key: '探索型/不追求读完', re: /(探索型|不追求读完|尚未读完|没有读完任何|只开不读|用.{0,4}收集.{0,4}代替.{0,4}阅读)/ },
  { key: '舒适区/积压/购书冲动', re: /(舒适区|积压|购书冲动|先消化|囤书)/ },
  { key: '评价偏高/宽容/选书眼光', re: /(评价偏高|比较宽容|选书眼光)/ },
  { key: '把进度0%当行为证据', re: /(进度(都)?是?\s*0%|0%\s*进度).{0,30}(说明|意味着|导致)/ },
];

function textOf(q) {
  return [
    q.analysis, q.readingInsight, q.recommendationStrategy, q.reply,
    ...q.libraryMatches.map((m) => `${m.reason || ''} ${m.timing || ''}`),
    ...q.externalMatches.map((m) => m.reason || ''),
  ].filter(Boolean).join('\n');
}

function phraseReport(a, b) {
  console.log('\n--- 假信号词频（出现即"关于这个人"的错误结论漏进了输出）---');
  for (const { key, re } of FALSE_SIGNALS) {
    const ca = a.queries.filter((q) => re.test(textOf(q))).map((q) => q.id);
    const cb = b.queries.filter((q) => re.test(textOf(q))).map((q) => q.id);
    console.log(`  ${key}`);
    console.log(`    ${a.tag}: ${ca.length} 条 ${ca.join(',') || '—'}`);
    console.log(`    ${b.tag}: ${cb.length} 条 ${cb.join(',') || '—'}`);
  }

  console.log('\n--- 具体性指标（理由字数 / 带《》引用的理由占比 / 引用在读状态）---');
  for (const r of [a, b]) {
    const recs = r.queries.filter((q) => q.mode === 'recommendation');
    const all = recs.flatMap((q) => q.libraryMatches);
    const avgLen = all.length ? Math.round(all.reduce((s, m) => s + (m.reasonLen || 0), 0) / all.length) : 0;
    const withRef = all.filter((m) => m.reasonMentionsBook).length;
    const inProgress = recs.filter((q) => textOf(q).match(/《[^》]+》(第|进度|正在读)/)).length;
    console.log(`  ${r.tag}: 推荐条数=${all.length} 理由平均字数=${avgLen} 含书名引用=${withLen(withRef, all.length)} 提到在读进度=${inProgress}/${recs.length}`);
  }

  const sum = (r) => {
    const t = {};
    let rounds = 0, ms = 0, n = 0;
    for (const q of r.queries) {
      for (const c of q.toolCalls) t[c.tool] = (t[c.tool] || 0) + 1;
      rounds += q.rounds; ms += q.wallMs; n++;
    }
    return { t, avgRounds: (rounds / n).toFixed(2), avgSec: (ms / n / 1000).toFixed(1) };
  };
  const sa = sum(a), sb = sum(b);
  console.log(`\n--- 汇总 ---`);
  console.log(`  ${a.tag}: 平均轮数=${sa.avgRounds} 平均耗时=${sa.avgSec}s 工具=${JSON.stringify(sa.t)}`);
  console.log(`  ${b.tag}: 平均轮数=${sb.avgRounds} 平均耗时=${sb.avgSec}s 工具=${JSON.stringify(sb.t)}`);
}

const withLen = (n, total) => `${n}/${total}(${total ? Math.round((n / total) * 100) : 0}%)`;

function report(a, b) {
  const byId = (r) => Object.fromEntries(r.queries.map((q) => [q.id, q]));
  const A = byId(a), B = byId(b);
  console.log(`\n=== 对比 ${a.tag} → ${b.tag}（model: ${a.model} / ${b.model}）===`);
  for (const id of Object.keys(A)) {
    if (!B[id]) continue;
    const x = A[id], y = B[id];
    console.log(`\n── ${id} [${x.kind}] "${x.prompt}"`);
    console.log(`   mode      ${x.mode} → ${y.mode}`);
    console.log(`   耗时      ${(x.wallMs / 1000).toFixed(1)}s → ${(y.wallMs / 1000).toFixed(1)}s`);
    console.log(`   轮/工具   ${x.rounds}/${x.toolCalls.length} → ${y.rounds}/${y.toolCalls.length}`);
    console.log(`   书库匹配  ${x.libraryMatches.map((m) => m.title).join('、') || '(空)'}`);
    console.log(`        →     ${y.libraryMatches.map((m) => m.title).join('、') || '(空)'}`);
    console.log(`   外部推荐  ${x.externalMatches.map((m) => m.title).join('、') || '(空)'}`);
    console.log(`        →     ${y.externalMatches.map((m) => m.title).join('、') || '(空)'}`);
    console.log(`   丢弃      ${x.matchValidation?.dropped ?? 0} → ${y.matchValidation?.dropped ?? 0}`);
    console.log(`   工具序列  ${x.toolCalls.map((t) => t.tool).join(',') || '(无)'}`);
    console.log(`        →     ${y.toolCalls.map((t) => t.tool).join(',') || '(无)'}`);
    console.log(`   analysis(${x.analysis?.length ?? 0}字): ${(x.analysis || x.reply || '').replace(/\s+/g, ' ').slice(0, 150)}`);
    console.log(`         →(${y.analysis?.length ?? 0}字): ${(y.analysis || y.reply || '').replace(/\s+/g, ' ').slice(0, 150)}`);
  }
  console.log('\n--- 多轮 ---');
  for (const m of a.multiTurn) {
    const mb = b.multiTurn.find((x) => x.id === m.id);
    if (!mb) continue;
    console.log(`\n── ${m.id}`);
    m.turns.forEach((t, i) => {
      const u = mb.turns[i];
      console.log(`   第${i + 1}轮 ${a.tag}: ${t.mode} ${t.libraryMatches.map((x) => x.title).join('、') || '(无书)'}`);
      console.log(`   第${i + 1}轮 ${b.tag}: ${u ? u.mode + ' ' + (u.libraryMatches.map((x) => x.title).join('、') || '(无书)') : 'N/A'}`);
    });
  }

  phraseReport(a, b);
}

// 入口放在文件末尾：report/phraseReport 用到的 const 都在上面，提前执行会踩 TDZ
if (compareArg) {
  const [a, b] = String(compareArg).split(',');
  const ra = JSON.parse(fs.readFileSync(path.join(RUN_ROOT, a, 'results.json'), 'utf8'));
  const rb = JSON.parse(fs.readFileSync(path.join(RUN_ROOT, b, 'results.json'), 'utf8'));
  report(ra, rb);
} else {
  main().catch((e) => {
    console.error('[eval] 失败:', e.message);
    process.exit(1);
  });
}
