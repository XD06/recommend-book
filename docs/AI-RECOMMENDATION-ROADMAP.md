# AI 智能荐书：现状诊断与实施路线图

> 受众：接手推荐/统计/画像相关工作的开发者与 AI Agent。
> 更新频率：事件驱动（推荐链路结构调整、注入策略变更、画像模型变化时更新对应小节）。
> 原则：本文所有断言均带 `文件:行号` 证据，且以当前工作区代码为准；标"推断"的尚未实机验证。
> 上次核对：2026-09-22（S6：书库/画像来源改为服务端直读 SQLite；同日 S7：推荐输出服务端校验、`update_user_profile` 写工具、采纳反馈表、书库硬闸门。§1、§2、§3 O1、§4、§5、§9 已按新结构重写，实施记录见 §10、§11）。

---

## 1. 当前推荐链路全图（已验证）

```mermaid
graph LR
    A[AIAdvisor.tsx:130<br/>只发 userRequest/userMood/history] --> B[POST /api/ai/recommend/stream<br/>ai.ts:314]
    B --> B2[createAgentContext<br/>libraryTools.ts:272<br/>书库+画像直读 SQLite]
    B2 --> C[buildLibraryOverview<br/>libraryTools.ts:1226]
    C --> D[callAgentStream<br/>aiService.ts:664<br/>单一 options 参数]
    D --> E[Phase 1 工具循环<br/>≤3 轮 非流式<br/>+ 书库硬闸门补 1 轮]
    E --> F[Phase 2 流式生成 JSON]
    F --> F2[validateAdvisorJson<br/>recommendValidation.ts:89<br/>bookId 对齐/修复/丢弃]
    F2 --> G[SSE: phase/tool_call/reasoning/chunk/book_update/done]
    G --> H[前端渲染 AdvisorResult<br/>AIAdvisor.tsx<br/>想读/跳过 → recommend-feedback]
    H -->|仅 externalMatches| I[App.tsx 造 Book<br/>status=UNREAD → /api/books/batch]
```

关键事实：

| 环节 | 实现位置 | 事实 |
|------|---------|------|
| 请求载荷 | `services/geminiService.ts:166`、`components/AIAdvisor.tsx:130-135` | 只发 `userRequest` / `userMood` / `conversationHistory`。**`library` 与 `userProfile` 已从流式请求体移除**，客户端传了也不作数 |
| 书库真源 | `backend/src/routes/ai.ts:314` → `libraryTools.ts:272` | 每个流式请求按 `req.user.id` 从 `books` 表载入整份书库 + 画像，`createAgentContext` 同时开出请求作用域的 `toolCache` / `webCalls` |
| Schema 能力 | `backend/src/routes/ai.ts` 的 `recommendStreamSchema` | 与非流式 `recommendSchema` 拆开：流式那份不再声明 `library`/`userProfile`，非流式保留（它不带工具循环，客户端书库只是请求数据） |
| 常驻注入 | `aiService.ts` 的 `getRecommendationsStream` → `libraryTools.ts:1226` | 每次请求注入：总量/状态分布、分类分布、难度分布、评分统计、紧凑品味画像、在读书籍详情、最近读完 5 本、按规模分档的书名索引（≤100 全量 / 101–300 节选 / >300 不注入，见 O2） |
| 画像注入 | `buildProfileBlock`（`aiService.ts:1338`，调用于 `:1366` 与 `:1845`） | 【用户画像】段与 `get_user_profile` 工具同源于一份 `user_profiles` 记录，不再取决于客户端是否透传（O1 已达成，见 §10） |
| 画像写回 | `libraryTools.ts` 的 `update_user_profile` → `database.ts:334` | Agent 可把对话里问出来的偏好写回 `user_profiles`；写后刷新 `ctx.userProfile` 并 `toolCache.clear()`，本次请求的后续工具即读到新值 |
| Agent 循环 | `aiService.ts:664` 起 | `MAX_ROUNDS = 3`，Phase 1 非流式；工具结果缓存在 `ctx.toolCache`（请求内有效，跨请求/跨用户不共享），写工具执行后 `ctx.toolCache.clear()`（`libraryTools.ts:1126`） |
| 硬闸门 | `aiService.ts:766` + `recommendValidation.ts:79` | `requireLibraryTool` 为真且本轮零书目查询、却给出非空 `libraryMatches` 时，追加 1 轮强制查证（`catalogQueries` 只认 `isLibraryCatalogTool`，画像类工具不算查过书目） |
| 写库 | `libraryTools.ts:1119` → `database.ts:278` | `update_book_status` 直接 `UPDATE` SQLite；SSE `book_update` 用于让客户端 patch 自己的内存副本，`App.tsx:225` 监听 |
| 输出校验 | `recommendValidation.ts:89`（在 `aiService.ts:1404` 应用） | `libraryMatches` 的 `bookId` 逐条对齐真实书库：对不上按书名唯一反查修复，修不掉才丢弃，计数随 `matchValidation` 回传并在界面提示 |
| 采纳信号 | `database.ts:132` 的 `recommendation_feedback` + `ai.ts:349/357` | 每条推荐挂「想读 / 跳过」；`requestId` 由前端生成（`AIAdvisor.tsx:106`）、随反馈请求写入，服务端不生成也不存 query 本身 |
| 落库 | `App.tsx` | 仅"新书建议"可一键入库为 `UNREAD`；"书库匹配"不写回；`types.ts` 的 `BookStatus` **没有"想读"状态** |

**结论：`libraryTools.ts` 头部注释所述"概览常驻 + 明细工具查"的混合策略已经落地，且数据源已收敛到 SQLite。S7 补上了"模型输出 → 界面"之间那段无人看守的路（幻觉 ID 不再静默消失）与"问出来的偏好 → 画像表"（S6 之前是断的）。当前剩余瓶颈：①采纳信号只进不出——记录了点击，但没有任何地方读它来影响下次排序，也还算不出采纳率（缺"展示了哪些"的分母）；②没有评估集，所以任何 prompt/注入改动都无法证明"变好了"。**

---

## 2. 什么算"真正智能推荐"：分级标尺

| 级别 | 判据 | 现状 |
|------|------|------|
| L0 关键词匹配 | 书名/分类字面相似 | 已超越 |
| L1 概览感知 | 模型看得到总量、分类、难度、在读 | **当前所处**（`buildLibraryOverview` 已满足） |
| L2 个体画像 | 模型看得到"这个人的稳定特征"：水平、目标、偏好、盲区、笔记 | **读写两端都闭合（2026-09-22）**：读——画像由服务端从 `user_profiles` 直读后注入，不取决于客户端透传；写——`update_user_profile` 工具把对话里问出来的偏好落回同一张表。端到端未验（需真实请求）。残余缺口只剩 `aiAnalysis`（盲区/建议方向）仍无人生成（见 O1「仍待做」） |
| L3 证据驱动 | 推荐理由可指回具体证据（"你在读《X》卡在进度 30%""你 3 本认知科学都没读完"） | 部分达成：工具能查，且查到的就是数据库里的真值（书库不再是客户端快照）；硬闸门还逼着模型在报书架上的书之前先真查一轮（见 §11）。但理由仍无法溯源到阅读史 |
| L4 闭环校准 | 采纳/搁置/读完/评分回流，成为下次排序信号，推荐命中率可度量 | **半条腿（2026-09-22）**：采纳信号已有采集端（`recommendation_feedback` 表 + 想读/跳过按钮），但**没有任何读取方**——既没回流到 prompt，也没算成指标；且缺"展示了哪些"的分母，采纳率算不出来。评估集仍完全缺失 |

**要走到 L4，缺的不是更大的 prompt，而是可度量的评估集与采纳信号。后半句的信号采集已建好，接下来差的是"读它"。**

---

## 3. 四项优化

### O1 接通用户画像链路（P0，最高杠杆）— 已达成，但落地形态与原方案不同

**原诊断（2026-09-18）**
- 后端读端点在：`backend/src/routes/profile.ts`（`GET /`、`category-meta`），已挂 `requireAuth`。
- 前端客户端方法 `services/bookService.ts`（`fetchProfile` / `saveProfile`）全仓无调用方。
- 因此 `context.userProfile === undefined` → 【用户画像】分支永不进入 → `get_user_profile` 工具永远返回 `{ error: '用户尚未设置画像信息' }`。

**根因**：画像的存储层与调用层都写了，中间那段"何时写、何时读、由谁填"没有接。历史上 `UserProfilePanel.tsx` 是画像编辑入口，已作为废弃组件删除，而 `AIAdvisor` 未接管取数。

**实际落地（两步）**
1. S1：设置页补轻量画像表单，`App.tsx` 登录后拉一次 `GET /api/profile`，作为 prop 透传给 AI 组件并放进请求体。
2. **2026-09-22 结构性修正**：第 1 步的"客户端透传"本身是个错误的中间形态——它把画像的可信度系于组件链路上每一环都不漏传，而漏传是静默的。现在流式端点在服务端 `createAgentContext(userId)` 内直读 `user_profiles`（`libraryTools.ts:231`），【用户画像】段与 `get_user_profile` 工具都取 `ctx.userProfile`（`aiService.ts:1329`、`:1799` 的 `buildProfileBlock`），**客户端不再传**。`App.tsx` 那次拉取只服务设置页表单显示。
   → 原方案第 2 条里的 `categoryContext`（"从某分类进入顾问"的场景）**未做**：schema 仍支持，前端从不填。

**仍待做**
- 原方案第 4 条：`aiAnalysis`（推断水平、盲区、建议方向）由 `/api/ai/profile/stream`（`ai.ts:489`）生成后回写 `user_profiles`。现状是**读的一端齐全、写的一端全缺**：`GET /api/profile` 会带出 `aiAnalysis`，设置页 `DataManagement.tsx:249-258` 会展示它，但表单不编辑它，唯一能生成它的 `/api/ai/profile/stream` **前端零调用** → 真实数据里 `ai_analysis` 恒为 NULL，注入的画像段少了"AI分析 / 盲区 / 建议方向"这三行，而这三行恰恰是最能改变推荐口吻的。
- ~~没有 `update_user_profile` 写工具~~ → **2026-09-22 已补**（S7，见 §11）。"AI 主动询问用户 → 偏好留得住"这条路径的断点已消除，但"问过之后画像段真的变了吗"仍需一次真实请求验证。
- 画像过期风险仍没处理：注入时不带"上次更新距今 N 天"的提示。`user_profiles.updated_at` 已由 `updateUserProfileInDb` 维护，读端只差一行文案。

**验收标准**
- `get_user_profile` 工具在真实请求中返回对象而非 error；SSE 的 `tool_call` 事件里可见。（**代码路径已闭合，端到端未验**：需要真实请求）
- 后端日志中 `userPrompt` 含【用户画像】段（可临时打印长度验证）。
- 同一 query 在改画像前后，推荐理由发生可观察变化（人工比对，非形式测试）。

**成本/风险**：已付出的成本见上；剩余风险是画像过期误导模型 → 注入时带 `lastUpdated`，超过 N 天标注"画像可能过时"（**未做**）。

---

### O2 常驻上下文重构：从"全量倾倒"到"分层注入"（P0）— 方案 1/2 已做

> 下面「证据」段是 2026-09-18 的诊断，行号已随后续重构漂移；现状见 §1 表格与 §9 实测。

**证据**
- `libraryTools.ts:1152` 的条件 `library.length <= 100` 决定【书库索引】是否注入 → **101 本时静默消失**，推荐行为发生不连续跳变，用户与开发者都无感。
- `libraryTools.ts:1160` 用自然语言再列一遍工具清单，与 function schema（`prompts/_shared.ts:26-30` + `withTools`）内容重复。
- 品味画像出现两次：概览内 compact 版（`:1123-1126`）+ `get_reading_taste_profile` 工具 full 版，`withTools` 还额外建议"优先调用"它 → 常见一次无收益的工具往返（Phase 1 每轮都是一次完整非流式 LLM 调用，见 `aiService.ts:657`）。
- 概览拼在 **user prompt**（`aiService.ts:1290`），而非 system。

**方案**
1. **分三档规模策略**取代单一 100 本开关：
   - ≤80 本：现状（全量索引）；
   - 81–300 本：只注入在读 + 最近读完 + 各分类 top-3 代表，其余强制走 `search_library`；
   - >300 本：再降一档，只注入统计与分类画像。
   每档在概览首行显式写明"当前为第 N 档，索引不完整"，让模型知道自己看到的是什么。
2. 删除 `:1160` 的重复工具清单（schema 已有描述）。
3. 概览与 system prompt 合并为**稳定前缀**（用户具体请求置于末尾），使前缀在支持自动前缀缓存的网关上可复用（DeepSeek 侧生效与否需在实际配置验证，**当前未证实**）。
4. 若保留 compact 画像，则从 `withTools` 文案里移除"优先调用 taste profile"的诱导，避免重复取数。

**实际落地与诊断的偏差**：阈值取 ≤100 全量 / 101–300 节选 / >300 不注入（`FULL_INDEX_LIMIT=100`、`CURATED_INDEX_LIMIT=300`、`PER_CATEGORY_INDEX=3`，`libraryTools.ts:1158-1160`），没有采用诊断建议的 80 本；档位声明写进【书库索引】那一节的小标题（"节选（N/M 本…）"、"未注入（共 M 本，超出注入上限 300 本）"）而非概览首行，并在同一句里直接下达"必须用 `search_library` 查询、禁止臆测"的指令。重复的工具清单提示行已删。方案 3、4 未做，理由见 §9「未做」。

**验收标准**
- 构造 79 / 81 / 301 本三套书库，概览长度、首行档位声明、工具调用次数均按预期变化（脚本比对，不落 AI 依赖）。
- 单次推荐请求的 prompt token 相对基线下降 ≥25%，且人工评分不降。**（已作废：前提错误，实测见 §9）**

**成本/风险**：集中在一个函数，中等；风险是削减注入后模型"看不全"→ 用档位声明 + 保留搜索工具兜底。

---

### O3 统计口径归一 + 数据可信度（P1）— 已做（S3）

> 下列行号是 2026-09-18 诊断时的位置，此后代码已变动；三项方案均已落地（`libraryStats.ts` 单一实现 + `GET /api/profile/stats`、`sort` 改为不原地修改、热力图改真实事件计数）。

**证据**
- 前端本地算一套：`StatsView.tsx:30-76`（状态数/页数/难度/均分）、`:222-223` 热门分类。
- 后端概览算另一套：`libraryTools.ts:1087-1120`。同一指标两份实现，口径漂移只是时间问题。
- `StatsView.tsx:222-223` 直接 `categories.sort(...)` —— `Array.prototype.sort` **原地修改**，这是 React props 对象，违反不可变约定（同数组来自 `App.tsx` 的 `categories`）。
- `ReadingHeatmap.tsx:37` 用 `Math.random()` 生成"每日阅读"数据，`:62` 月标签写死 1–7 月。热力图目前**是装饰，不是统计**。

**方案**
1. 统计口径下沉到后端：`GET /api/profile/stats` 返回 `{ totals, byCategory, byLevel, byStatus, monthly }`，`buildLibraryOverview` 与前端改为同一数据源（或同一纯函数）。
2. 前端 `categories.slice().sort(...)`，或直接消费后端已排序结果。
3. 热力图二选一：接真实数据（需要阅读行为流水表，见 O5）或**明确摘掉**，不要留假数据在"统计"页。

**验收标准**：同一份书库，页面数字与发给模型的概览数字逐项相等；仓库内不再出现 `Math.random()` 参与展示数据生成。

---

### O4 移动端可用性（P1，成本低、确定性高）— 6 项 + 标签栏已改（S4），四断点人工验证待做

> 下列行号是 2026-09-18 诊断时的位置，此后代码已变动。底部/顶部导航的避让已统一由 `styles.css` 的 `--bottom-nav-h` / `--top-nav-h` 驱动，不要再各处写魔数（见 AGENTS.md「移动端与样式」）。


**已核实缺陷**

| 缺陷 | 证据 | 后果 |
|------|------|------|
| 底部导航用了未定义的 `safe-area-pb` | `Navbar.tsx:182`；`styles.css` 只有 `pb-safe` | iPhone 手势条压住底部 tab |
| "添加书籍"窄屏隐藏 | `Navbar.tsx:158` `hidden sm:flex` | <640px 无导入入口（移动端主路径断裂） |
| 统计侧栏窄屏整体隐藏 | `LibraryView.tsx:408` `hidden lg:block` | <1024px 看不到时间线/热力图 |
| 三列网格无断点 | `DataManagement.tsx:83` `grid-cols-3` | 窄屏卡片挤压 |
| 弹层固定高度 | `BookQA.tsx:203`、`ReadingAssistant.tsx:160`（`h-[400px]/h-[500px]`）嵌在 `StatsView.tsx:298` `max-h-[85vh]` | 矮屏内容被裁 |
| Toast 最小宽度 | `Toast.tsx:101` `min-w-[300px]` + 右上定位 | 320–360px 屏溢出 |

做得对的：`AIAdvisor.tsx:184,261` 用 `100dvh`，`StatsView.tsx:290` 移动端已用 bottom-sheet。
待实机确认（**推断**）：`BookDetail.tsx:435` 四个标签无 `overflow-x-auto`/`flex-wrap`，375px 以下可能换行溢出。

**方案与验收**：以上 6 项逐项修；320 / 375 / 768 / 1024 四档人工过一遍主路径（登录 → 导入 → 浏览 → 问顾问 → 采纳入库）。移动端"添加书籍"必须有可用入口，统计侧栏改为可折叠区块而非直接隐藏。

---

## 4. 达成 L4 的真正缺环（建议单列为 O5）

1. **采纳反馈闭环** —— **采集端已建（2026-09-22，见 §11），读取端为零**。
   - 现落地的形态比原方案窄：新表 `recommendation_feedback` 记录 `(user_id, request_id, book_id, title, source, action, category, reason, created_at)`，`action` 只有 `want` / `skip` 两个显式点击；**不记"展示了哪些"**，所以算不出严格采纳率（缺分母），只能算"点掉的书里各分类/来源的占比"。`book_id` 故意不加外键——删书不该把历史信号一起删掉。
   - 原方案里的"角色=主书/补充/放松""后续是否在读/读完""评分"三项**都未记录**。前者因为反馈项里没带 `role`；后两者因为读完/评分本就在 `books` 表里，join `title`/`book_id` 可事后推导，就没重复存。
   - 建表安全性已核实：`CREATE TABLE IF NOT EXISTS` 对新表有效，每次启动都重跑，**不需要迁移**；改已有表列才会失效（无迁移系统，见 ARCHITECTURE §6）。
   - 下一步该做的是"让它影响下次推荐"：把近 N 条 `want` / `skip` 摘要拼进【用户画像】段之后（例如"最近跳过 4 本心理学入门，想读集中在投资实操"）。**没有下面第 2 条的评估集之前，这属于盲改** —— 它一定会改变输出，但不一定变好。
2. **评估集**：固定 20–30 条 query（覆盖明确目标/模糊心情/跨类/难度不适配/续读五类），每次改 prompt 或注入策略跑一遍，按相关性·多样性·难度适配三维人工打分。没有它，O1/O2/S7 的"变好了"只是感觉。**未开始。**
   - 现成可复用的调用样例：`backend/test-recommend-stream.js`、`test-stream.js`。
   - **红线**：这类脚本直连真实 AI API 会消耗 token，运行前须说明并征得同意。
   - S7 之后这套评估多了一项免费指标：同一批 query 的 `matchValidation.dropped` 总和 / `libraryMatches` 总数 = **幻觉率**，可直接从后端日志 `[AI] 推荐校验:` 读出，不需要人工打分。
3. **状态语义**：`types.ts:1-4` 缺"想读"，导致推荐采纳只能落成 `UNREAD`，与"未读的书"混在一起，读历史信号被污染。想读/跳过现在活在 `recommendation_feedback` 里、不污染 `BookStatus`，但这只是绕开不是解决：用户点"想读"再点"加进书架"，库里仍是 `UNREAD`。

---

## 5. 已建未接的能力（不是新需求，是接上线）

按"后端端点 → 前端客户端方法 → 组件调用方"三层核对（2026-09-22 为 S7 接线后重跑 grep 与 `router.` 列表所得，路由行号仍会随后续改动漂移，复核请直接 `grep -n "^router\." backend/src/routes/ai.ts`）：

**后端有、客户端方法也有、组件零调用（6 条流式）**：`/reading-path/stream`（`ai.ts:382` → `generateReadingPathStream`）、`/reading-insights/stream`（`:457` → `generateReadingInsightsStream`）、`/profile/stream`（`:489` → `analyzeUserProfileStream`）、`/compare-books/stream`（`:514` → `compareBooksStream`）、`/reading-summary/stream`（`:556` → `generateReadingSummaryStream`）、`/notes/stream`（`:587` → `organizeNotesStream`）。
其中 `/profile/stream` 正是 O1 第 4 条要用的那个，`/reading-insights/stream` 与 `/notes/stream` 是统计页与笔记功能的现成后端 —— 接 UI 的成本低于重写。

**后端有、连客户端方法都没有**：`/category-advice`（`:223`）。

**非流式且客户端方法零调用（3 条）**：`/recommend`（`:206` → `getRecommendations`，`aiService.ts:1132`）、`/insight`（`:252` → `generateInsight`）、`/reading-path`（`:278` → `generateReadingPath`）。前两条与各自的 `/stream` 版本功能重叠，而 `/stream` 版本已在用（`AIAdvisor` / `BookDetail`）；`reading-path` 则两个版本都没人调。它们不影响正确性（非流式路径是单次 `callAI`，既不带工具循环也改不了库），删除属高影响动作，**待用户决策**：接 UI 还是摘掉。
注意 S7 的输出校验**只加在流式那条**（`getRecommendationsStream` 末尾）——`getRecommendations` 连 `ctx.library` 都没有（书库来自请求体），要对齐得先把它并入 Agent 路径，故未动。这也再次说明：接 UI 时应接 `/recommend/stream`，不是 `/recommend`。

`book_update` 断线**已修复**：`App.tsx:225` 监听 `aiBookUpdate`，`AIAdvisor` / `BookDetail` / `BookQA` / `ReadingAssistant` 四处派发。2026-09-22 之后写库直接发生在服务端，该事件只负责让客户端内存副本跟上数据库（见 §1），且 `routes/ai.ts` 的 `sseHandlers()` 对全部流式端点一律接上，新增端点不会再漏。

无引用 hooks：`hooks/useAIRequest.ts`、`useAIStreaming.ts`、`useDebounce.ts`（后者与 `App.tsx` 的手写防抖重复）。

---

## 6. 建议顺序与阶段 DoD

| 阶段 | 内容 | DoD（可验证） | 状态 |
|------|------|--------------|------|
| S1 | O1 画像接线 + §5 的 `aiBookUpdate` 断线 | 工具返回真实画像；AI 改状态后界面与 DB 一致 | 代码已接完，构建通过；**端到端未验**（需真实请求看 `tool_call`）。画像那半已被 S6 取代（改由服务端直读） |
| S2 | O2 分档注入 + 删冗余 | 三套规模书库行为符合预期；prompt token ≥25% 下降 | 分档 + 声明 + 删重复行已做并实测；**token ≥25% 未达成**（见 §9）；方案 3/4 未做 |
| S3 | O3 统计归一（含 `sort` 与热力图） | 页面数字与概览数字逐项相等 | 已做（后端单一实现 + 新接口），热力图改为真实事件 |
| S4 | O4 移动端 6 项 | 四档断点主路径人工通过 | 6 项 + 标签栏共 7 处已改；**四断点人工验证待做** |
| S5 | O5 反馈表 + 评估集 | 拿到第一次基线分数，此后每次 prompt 改动必须报分差 | **半做**：反馈表那半以 `recommendation_feedback` 落地（S7 顺带做完采集端），评估集仍未开始 —— 没有基线分数，所以 S7 的四项改动都还无法证明"变好了" |
| S6 | 结构修正：Agent 书库/画像改服务端直读 SQLite、`book_update` 语义反转、工具缓存改请求作用域、`callAgentStream` 改 options 参数、修对话历史重复注入与前端吞错误 | 前后端构建全绿；流式请求体降到 KB 级；AI 改状态后刷新页面仍保留 | 代码完成，两个构建全绿（后端 tsc 零输出、前端 vite ✓）；**运行时未验**，清单见 §10 末 |
| S7 | 推荐输出校验与自愈（后端校验 `bookId`，幻觉/漂移时用书名反查修复，修不掉才丢弃并把计数回传界面）+ `update_user_profile` 写工具 + 采纳反馈表与想读/跳过按钮 + 书库硬闸门 | 幻觉 ID 不再被前端静默丢弃；Agent 问出来的偏好下次会话仍在 | 代码完成，两个构建全绿、root tsc 保持基线 27；DB 与 HTTP 冒烟实测通过（见 §11「已验证」）；**端到端未验**（需真实请求），清单见 §11 末 |

S1/S2 决定推荐"像不像懂你"，S5 决定"能否持续变好"。S3/S4 是使用面信任与触达。S6 拆掉了"客户端那份快照就是书库"这个错误前提，S7 补的是模型输出到界面之间最后一段无人看守的路。

---

## 7. 非目标（本轮明确不做）

- 不做协同过滤/向量召回/嵌入检索等推荐系统基建：个人书库场景下信号量不足以喂饱，优先吃掉画像与闭环收益。
- 不做多模型 A/B 平台、不做在线学习。
- 不重构 `aiService` 的两阶段架构（11s 首字节阻塞已由"Phase 1 实时推 reasoning + 跳过冗余 Phase 2"解决，见 commit `855fc04`），只在注入内容上做文章。S6 动的是 `callAgentStream` 的**参数形态与数据来源**，Phase 1/Phase 2 的结构、`MAX_ROUNDS`、前缀回放逻辑一律未变。
- 不为凑齐"测试通过"新建 ESLint/单测脚手架：本仓库现状是无测试、`npm run lint` 无配置（ARCHITECTURE §6），如实报告即可。

## 8. 验证手段（本项目的现实约束）

唯一自动化门槛 = `npm run build`（根，vite）+ `cd backend && npm run build`（tsc）。
其余一律人工：`backend/test-*.js` 冒烟、浏览器实机走主路径。推荐质量属主观效果，**必须靠 §4 的评估集人工打分**，不要以"构建通过"冒充"推荐变好了"。

---

## 9. S1–S4 实施记录（2026-09-18）

改动落在：`App.tsx`、`styles.css`、`start.bat`、`components/{AIAdvisor,StatsView,DataManagement,LibraryView,ReadingHeatmap,BookQA,ReadingAssistant,BookDetail,Navbar,Toast}.tsx`、`services/bookService.ts`、`backend/src/{routes/ai.ts,routes/profile.ts,routes/books.ts,services/aiService.ts,services/libraryTools.ts,services/libraryStats.ts(新增),prompts/readingAdvisor.ts}`。

写库回传（`book_update`）接通了三个入口：`/recommend/stream`、`/book-qa/stream`（本次补）、`/assistant/chat/stream`（此前已有）。当时仍传 `undefined` 的是 `/insight/stream` 与 `/reading-path/stream` —— 这两个是单次生成任务，提示词从不要求改状态，暂未接线（该残余已在 S6 一并消除，见 §10）。

### 追加：寒暄也会输出整份书单（模式判定被位置稀释）

**现象**：移动端发"你好"，AI 顾问直接给出三本书组合的完整推荐。

**排查**：`readingAdvisor.ts` 的系统提示本身没写错——`:39-62` 有"响应模式判断"规则，`:258` 的示例 1 就是"你好"→ conversation。问题是这套 370+ 行提示几乎全在讲怎么推荐，判定规则夹在中间；更关键的是 `withTools`（`prompts/_shared.ts:89`）会把"建议优先使用 get_reading_taste_profile…"这段**追加到系统提示最尾部**，把判定规则挤成了中段文本。弱模型按尾部惯性走推荐分支。

**修法**（不重构提示词，只挪位置 + 改掉反向措辞）：
- 模式闸门写成用户提示词的**最后一条**（流式：`aiService.ts` 的 `getRecommendationsStream`；非流式：`readingAdvisor.ts:437` 的 `buildReadingAdvisorUserPrompt`），显式给出"寒暄/闲聊/问你是谁/需求太笼统 → conversation，reply ≤150 字、不给书单、不必调工具"。
- 删掉 advisor `extraHint` 里"直接给出推荐"的措辞，改为"直接回答即可（寒暄或笼统请求按对话模式简短回应，不要输出书单）"。

**状态**：改动已构建通过，但**尚未经过一次真实请求验证**——用户截图里那份"你好→书单"是 localStorage（`storageKey = 'ai-advisor-chat'`）恢复的历史消息，当时后端日志 `POST /api/ai` 计数为 0，不是新链路跑出来的。须由用户新发一条消息复测。

### 实测：概览注入字符数（真实 413 本书库 + 合成库）

| 书库规模 | 改动前 | 改动后 | 变化 |
|---------|-------|-------|------|
| 20 / 50 / 99 本（完整档） | 2337 / 4559 / 7624 | 2184 / 4406 / 7471 | **−2% ~ −6.5%**（索引本就注入，只少了 167 字符重复提示行） |
| 101 / 200 / 300 本（节选档） | 2851 / 4766 / 6589 | 5954 / 9860 / 13182 | **+99% ~ +109%** |
| 301 / 413 本（未注入档） | 6589 / 1509 | 6551 / 1471 | −0.6% ~ −2.5% |

**结论：S2 的"prompt token ≥25% 下降"这条 DoD 未达成，且事后看前提就是错的。** 概览里真正冗余的只有那行与 `withTools` 重复的工具清单（167 字符）。101 本以上的问题不是"注入太多"，而是"书名静默消失"——修法是补一节可控的节选并声明覆盖范围，所以该档注入量必然上升。已把这条 DoD 标为不成立，不要再拿它当目标。

### 未做（有意不做，不是遗漏）

- **O2 方案 3**（概览并入 system 做稳定前缀以吃前缀缓存）：DeepSeek/LiteLLM 侧是否真能命中前缀缓存**未证实**，改了也无法自证收益 → 不做。
- **O2 方案 4**（移除"优先调用 taste profile"的诱导）：未做，该措辞现在仍在 `prompts/_shared.ts:90` 的 `withTools` 尾部，且被拼进**每一个** AI 系统提示。这是纯推荐质量改动，没有 §4 评估集之前动了就是盲改 → 挂起，等 S5。
- **S1 端到端验收**（真实请求里 `get_user_profile` 返回对象、SSE 可见 `tool_call`）与 **S4 四断点人工验证**：都需要登录态；不打算在用户本地库里注册测试账号，交由用户跑。
- **`/insight/stream`、`/reading-path/stream` 的 `book_update`**：当时的状态是这两条链路工具集与推荐共用同一份 `getAllTools()`，模型理论上仍可自由调 `update_book_status` 而回调是 `undefined` → "说了没做"的残余。**S6 已消掉这一条**：`sseHandlers()` 对全部流式端点一律接上 `onBookUpdate`，写又直接落 SQLite，所以不会再出现"改了库但没人知道"。仍没做的是另一半 —— **只读工具开关**：解读/路径这类单次生成任务其实不该有写权限，现在它们有。
- **S5**：需要新增 `recommendations` 表（本仓库无迁移系统，加表 = 手工执行或删库重建）+ 消耗真实 token 跑评估集 → 未开始。

### 已验证的部分

- `npm run build`（前端 vite）与 `cd backend && npm run build`（tsc）全绿。
- 排障：AI 全量 `fetch failed` 定位为 Node 全局 `fetch` 不读 `HTTP(S)_PROXY` + 本机 DNS 把 LLM 域名解析成 `127.x` 占位地址；同一请求带 `NODE_USE_ENV_PROXY=1` 后实测 200。已写入 `start.bat` 与 README 常见问题。
- `GET /api/profile/stats` 未带 token 返回 401（路由挂载 + 鉴权生效）；`computeLibraryStats` 直连真实库跑通：413 本、在读 4、未读 409、19 个分类、已评 393 本均分 8.5。
- 三档注入的实际输出逐档打印核对过。

---

## 10. S6 实施记录（2026-09-22）

改动落在：`backend/src/{index.ts,db/database.ts,routes/ai.ts,routes/books.ts,routes/profile.ts,services/aiService.ts,services/libraryTools.ts,services/webSearchService.ts,types/index.ts}`、`services/geminiService.ts`、`App.tsx`、`components/{AIAdvisor,BookDetail,BookQA,ReadingAssistant,StatsView}.tsx`，文档同步改 `ARCHITECTURE.md` §2/§3/§4 与本文件。

### 做了什么

1. **书库与画像的真源搬到 SQLite**：`createAgentContext(userId)`（`libraryTools.ts:272`）在每个流式请求开始时 `loadUserLibrary` + `loadUserProfile`，10 条 `/stream` 路由统一改用它（`ai.ts:314` 起各处）。请求体的 `library` / `userProfile` 删除，`recommendStreamSchema` 与 `recommendSchema` 拆成两份（非流式保留原字段，它不带工具循环）。前端 9 个流式客户端方法去掉对应参数，`AIAdvisor` / `ReadingAssistant` / `StatsView` / `BookQA` / `BookDetail` 的 prop 链一并拆掉。
2. **写库直落 SQLite**：`update_book_status` → `updateBookProgressInDb(ctx.userId, ...)`（`libraryTools.ts:1119` → `database.ts:278`），写后 `ctx.toolCache.clear()`。`book_update` 从"请前端替我写库"变成"前端你的副本过期了"。
3. **`sseHandlers(res, signal)`**（`ai.ts:101`）集中把 5 个回调（chunk / phase / tool_call / reasoning / book_update）连同 abort signal 接到 SSE 上，对**全部**流式端点一律接 `onBookUpdate`。原先各路由手写回调、`/insight` 与 `/reading-path` 传 `undefined` 的形态没了。`BookDetail` 的 AI 解读此前完全没接写回，是这条改动顺带补上的真实缺陷。
4. **工具缓存与 Web 用量改请求作用域**：`toolCache` / `webCalls` / `webCostUsd` 挂到 `AgentContext`；`webSearchService` 不再持有模块级计数。
5. **`callAgentStream` 改单一 options 参数**（`aiService.ts:664`）：`{ systemPrompt, userPrompt, ctx, handlers, temperature, jsonMode, conversationHistory, requireLibraryTool }`（最后一项 S7 加）。10 个流式服务函数签名统一成 `(ctx, input, handlers)`。
6. **两个静默缺陷**：`/recommend/stream` 的对话历史重复注入（提示词内联 + 结构化 messages 各一份）；前端 `fetchSSEStream` 把帧解析与回调分发塞进同一个 `try`，导致后端 `error` 事件的报错被吞。
7. **数据访问下沉**：`BookRow` / `rowToBook` / `bookToParams` / `UPSERT_BOOK_SQL` / `loadUserLibrary` 从 `routes/books.ts` 移进 `db/database.ts`，`books.ts` 少 113 行、`profile.ts` 改用同一份读取函数。Agent 与 REST 路由不再各写一套 SQL。

### 刻意没做

- **只读工具开关**：解读 / 阅读路径这类单次生成任务其实不该有 `update_book_status` 权限，现在仍然有。接线已安全（写会落库且客户端会收到通知），但"该不该让它写"是另一个问题。
- **§5 那批无调用方的端点**（6 条流式 + 3 条非流式）：删路由属高影响动作，未自作主张，待用户决策接 UI 还是摘掉。
- **推荐输出校验与自愈**：当时未做，现为 S7 主体，实施记录见 §11。

### 已验证

- `cd backend && npm run build`（tsc）零输出全绿；`npm run build`（前端 vite）✓ built in 8.91s。
- 根目录 `npx tsc --noEmit`：本轮一度到 28 条 TS6133，新增的那条是 `aiService.ts` 里已无使用方的 `ChatMessage` 导入，删除后回到 27 条 —— 与 AGENTS.md 记录的历史基线逐条一致，未顺手修范围外的历史报错。
- 全量 `git diff` 审查过：未触碰 `AGENTS.md`、`docs/archive/**`、`.env`、`backend/data/`、`cache.json`；用户自己未提交的闪黑带调查文件（`index.html`、`styles.css`、`CHANGELOG.md` 的相关条目、`strip/`、`*.cjs`、`*.ps1`）不在本次改动范围内。

### 未验证 —— 人工清单（需登录态；不在用户本地库注册测试账号）

1. 后端启动带 `NODE_USE_ENV_PROXY=1`（`start.bat` 已内置）。
2. 发一条推荐请求，看后端两条日志：`[AI] ✓ body parsed: N KB`（`index.ts:84`）应在 KB 级（413 本书库时代是数百 KB），紧跟的 `[AI] recommend/stream 开始处理, library size: N`（`ai.ts:319`）应等于你书库的真实本数。前者回升说明客户端又开始传全量库；后者为 0 说明 `createAgentContext` 没读到库（鉴权或用户 id 问题）。
3. AI 顾问发"你好"→ 走对话模式、不给书单；发明确请求 → 出三层书单。
4. **S6 核心验收**：让 AI"把《X》标记为读完"，然后**刷新页面**，状态仍是已读。写库不再依赖客户端下一次防抖全量保存，这是本轮唯一能一眼看出结构变了的地方。
5. 同一次会话连说两句：第二句不重复第一句的历史（后端日志里 prompt 长度与工具调用次数不异常翻倍）。
6. 用错 Key 或断网触发后端报错 → 界面应显示后端给的具体错误，而不是通用"抱歉，回答时出了点问题"。
7. 多用户回归：A 账号让 AI 查书库，结果里不应混进 B 账号的书（请求作用域缓存的回归点）。
8. 书库详情页的"AI 解读"跑完后，若模型顺手改了状态，详情页与列表应同步显示。

### 当时的下一步 = 已做的 S7

- **输出校验与自愈**、**`update_user_profile` 写工具**：均已于同日实施，另加采纳反馈表与书库硬闸门，记录见 §11。

### 仍未做（从 S7 清单里剩下的那条）

- **`relevanceScore` 定去留**：模型每条推荐都输出这份置信度（`prompts/readingAdvisor.ts:228,301,350`，类型在 `backend/src/types/index.ts:252` 与 `types.ts:196`），前端**零消费方**（2026-09-22 重跑 grep 确认，S7 没碰它）。要么在界面上用起来（按置信度排序 / 展示"为什么是这 3 本"），要么从 schema 去掉——留着只会让模型把注意力花在给自己打分上。

---

## 11. S7 实施记录（2026-09-22）

改动落在：`backend/src/services/recommendValidation.ts`（新增）、`backend/src/services/{aiService,libraryTools}.ts`、`backend/src/db/database.ts`、`backend/src/routes/ai.ts`、`backend/src/types/index.ts`、`backend/src/prompts/{_shared,readingAdvisor}.ts`、`services/geminiService.ts`、`types.ts`、`components/{AIAdvisor,DataManagement}.tsx`、`App.tsx`，文档同步改 `ARCHITECTURE.md` §2/§3/§4/§6、`CHANGELOG.md`、本文件与本地 `AGENTS.md`。

### 做了什么

1. **推荐输出服务端校验与自愈**（`recommendValidation.ts:89` 的 `validateAdvisorJson`，接在 `aiService.ts:1404`）：`libraryMatches` 逐条与 `ctx.library` 对齐 —— `bookId` 命中即保留；未命中则用归一化书名（剥《》与版次标记、统一冒号、压缩空白）反查，**只认唯一命中**（同名多本直接放弃，含模糊匹配也要求全库唯一），修不掉才从数组里剔除。计数 `{ kept, repaired, dropped, droppedTitles }` 挂成 `matchValidation` 随响应回传，`AIAdvisor.tsx:508-520` 在真有丢弃时提示"已过滤 N 条"并列出书名。
   - 为什么放在 `callAgentStream` 返回之后而不是 SSE 回调里：客户端渲染的是 `done` 事件里那份解析结果，chunk 只是原文预览（见 §1）。清洗点因此落在 `getRecommendationsStream` 的返回值上 —— 只覆盖流式这一条出口，非流式 `/recommend` 未接（见「刻意没做」）。
   - 与原方案的偏差：原写"把丢弃数随 SSE 报出来"，实际是塞进 `done` 的 JSON 载荷里 —— 少一种事件类型，前端不需要新增分支。
2. **`update_user_profile` 写工具**（`libraryTools.ts:1154`，Agent 工具 9→10）：参数与 `UserProfilePatch` 对齐，逐字段校验（`readingLevel` 必须 ∈ `beginner/intermediate/advanced/expert`、`readingGoal` trim 后截 200 字、`preferredCategories` 逐项 trim + 去空并限 10 项、`dailyReadingTime` 需正数、取整后夹到 600 分钟），非法字段收进 `invalid[]` 回给模型而不整笔失败；无任何有效字段时返回 `{ success: false, message: '没有可更新的画像字段' }` 而不是静默成功。写入走 `updateUserProfileInDb`（`database.ts:334`）—— 与 REST 的 `PUT /api/profile` **共用同一份 SQL**，两条写路径不会各自漂移出一个字段。写后 `ctx.userProfile` 立即换新、`ctx.toolCache.clear()`，同一次请求后续工具读到的是新画像。提示词侧在 `readingAdvisor.ts` 的"个性化记忆与目标追踪"里加了一条"落盘才算记住 + `preferredCategories` 是覆盖式更新"，`_shared.ts` 的工具清单同步列出该工具。
3. **采纳反馈**：新表 `recommendation_feedback`（`database.ts:132`，含 `idx_rec_feedback_user_time` / `idx_rec_feedback_user_book` 两个索引）+ `addRecommendationFeedback`（`db.transaction` 批量插入，`reason` 截 500 字）+ `listRecommendationFeedback`（limit 夹在 1..500，snake_case → camelCase）；路由 `POST/GET /api/ai/recommend-feedback`（`ai.ts:349` / `:357`，Zod 限定 `items` 1..30、`source` ∈ library|external、`action` ∈ want|skip）。前端 `AIAdvisor` 的书库匹配卡与新书建议卡各挂「想读 / 跳过」（`FeedbackButtons`，`AIAdvisor.tsx:393`），点击即乐观更新、请求失败回滚；`requestId` 在发起请求时生成（`AIAdvisor.tsx:106`）并回写进响应对象，用于归组。
4. **书库硬闸门**（`aiService.ts:766`）：Phase 1 里模型不再调工具、准备交答案时，若本轮 `catalogQueries === 0` 且 `claimsLibraryMatches(response.content)` 为真，则不采信这一轮，追加一条"这些 bookId 无从核对，先查书库；确实没有就把 `libraryMatches` 留空改用 `externalMatches`"的用户消息，并把 `maxRounds` 抬到 `round + 2`（**只补一次**，`gateFired` 防循环）。
   - 计数只认 `isLibraryCatalogTool`（`libraryTools.ts:105`）：`get_user_profile` / `update_user_profile` 虽在 `LIBRARY_TOOL_NAMES` 里，但它们证明模型看了"人"、没看"书目"，认它们等于让一次画像查询蒙过闸门。Web 搜索工具同样不填 `libraryMatches` 的 `bookId`，也不认。
   - 只在 `ctx.library.length > FULL_INDEX_LIMIT`（100）时启用（`aiService.ts:1399`）：≤100 本的概览里就是全量 `[id] 书名`，直接引用不算幻觉，强制它再查一轮纯属加时延；且这条与 AGENTS.md"概览足够即可直答"一致。判据限定在"声称推了书架上的书"，所以寒暄回复（`libraryMatches: []`）不会被拖去多花一轮。
5. **顺带修掉的静默互覆**：设置页 `handleSaveProfile` 原先展开挂载时那份快照整体 PUT，而快照一次会话只拉一次 → AI 刚用 `update_user_profile` 写进去的偏好，用户点一次"保存画像"就按旧值冲回。现改为只发表单自己的四个字段（`DataManagement.tsx:73-78` 留了原因注释），且 `App.tsx` 在进入设置页时重拉 `GET /api/profile`。

### 刻意没做

- **反馈不回注 prompt**：数据只在库里攒，没拼进【用户画像】段。理由与 §4 一致 —— 没有评估集时这是盲改，一定会变、不一定变好。
- **不记"展示了哪些"**：所以严格采纳率仍算不出（缺分母）。要补就在 `done` 之前把本次推荐的标题集合写一张 impressions 表，属新表新端点，未纳入本轮。
- **`role`（主书/补充/放松）不进反馈表**：现字段里没有它，"主书比放松更容易被采纳"这类分析暂时做不了。
- **只读工具开关**：S6 那条未做项照旧 —— 解读/阅读路径仍有 `update_book_status` 权限。
- **非流式 `/recommend` 不加校验**：它的书库来自请求体，没有 `ctx.library` 可对齐（见 §5）。

### 已验证（2026-09-22）

- `cd backend && npm run build`（tsc）零输出全绿；`npm run build`（前端 vite）全绿。
- 根目录 `npx tsc --noEmit`：**27 条**，与历史基线逐条一致。本轮一度到 28（新增的 `RecommendationFeedbackItem` 导入未用、参数就地内联了类型），改为 `Omit<RecommendationFeedbackItem, 'action'>` 后回到 27；未顺手修范围外的历史报错。
- **`validateAdvisorJson` / `claimsLibraryMatches` 纯函数冒烟（零 token，2026-09-22 重跑于 `backend/dist`）：20 条断言全过**。覆盖：真 ID 保留、幻觉 ID 按书名修复（含《》剥离）、无匹配丢弃并回 `droppedTitles`、**归一化撞名（"原则" 与 "原则（中文版）"）时丢弃而不猜**、模型多抄副标题时唯一包含命中可修复、非 JSON / 缺字段 / 空数组三种原样返回、`externalMatches` 一律不碰、清洗后 `mode` 等其余字段不丢；闸门判据 5 条（寒暄空数组、非数组、缺字段均不算"声称推书"）。
- **`recommendation_feedback` DB 层冒烟（临时 cwd 的独立库，13/13 断言通过）**：建表与两个索引、批量写入返回条数、`request_id` 归组、`list` 的 camelCase 映射与 limit 夹取、外键 `ON DELETE CASCADE`、`reason` 截断。
- **HTTP 层冒烟（隔离实例 `PORT=3999`，不碰用户实例）**：无 token → 401；缺 `items` / `action` 非法值 → 400 且 Zod 报错路径精确到 `items.0.action`；`POST` 后 `GET` 回读一致；顶层 `requestId` 正确落到每一行。
- **本轮实测发现并修掉的一个真缺陷**：`POST /recommend-feedback` 起初收下顶层 `requestId` 却没摊进 items，`request_id` 会静默存成 NULL —— 归组列白建。修为 `items.map(item => ({ ...item, requestId }))` 并重测（两行都带回 `requestId`）。
- **画像 patch 语义经 REST 端到端复核**：`PUT /api/profile` 不带 `dailyReadingTime` 时，该字段保持原值（25）不被清空 —— 这是 S7 与设置页共用写入函数后才成立的性质。
- 用户实例（:3001，`tsx watch`）热重载后新路由返回 401，说明 `recommendation_feedback` 已在其真实库中自动建表。这是预期且无害的（新表不需要迁移，见 ARCHITECTURE §6）。

### 未验证 —— 人工清单（需登录态 + 真实 AI 请求，会消耗 token；跑前告知）

1. 后端带 `NODE_USE_ENV_PROXY=1` 启动（`start.bat` 已内置）。
2. **闸门**：把书库撑到 >100 本（或直接在现有库上）问一句"推荐我书架里的三本"，看后端是否打印 `[AI] 书库硬闸门: 未查询书目就给出 libraryMatches，追加 1 轮强制查证`，随后 `tool_call` 事件里应出现 `search_library` / `get_category_stats`。不打这行也是正常的（模型本来就查了），要看的是它出现时结果是否变准。
3. **校验**：后端日志 `[AI] 推荐校验: 保留 N 条（其中按书名修复 M 条），丢弃 K 条`。K>0 时界面应出现"已过滤 K 条…"。若一轮里频繁出现 repaired>0，说明书名与 ID 的对齐在提示词里还不够（可考虑在概览索引里强制模型抄 `[id]`）。
4. **画像写**：对 AI 顾问说"我最近只想读入门级的、每天只有 20 分钟"，看 `tool_call` 里是否出现 `update_user_profile`、返回 `success: true`；然后**开设置页**，表单应显示新值（进页重拉生效），随手点"保存画像"后刷新页面，值不应被旧快照冲回。
5. **采纳反馈**：点两条推荐的「想读」/「跳过」，`SELECT * FROM recommendation_feedback ORDER BY id DESC LIMIT 5;` 应有对应行且 `request_id` 非 NULL；断网点一次 → 按钮状态应回滚，不留下"看着记上了其实没记"的假象。
6. **回归**：寒暄"你好"仍走对话模式、不因为闸门多耗一轮（闸门判据是 `libraryMatches` 非空，对话模式恒为空数组）。
7. 多用户：B 账号 `GET /api/ai/recommend-feedback` 不应看到 A 的任何一条（该端点在 `router.use(requireAuth)` 之后，且查询按 `user_id` 过滤）。

