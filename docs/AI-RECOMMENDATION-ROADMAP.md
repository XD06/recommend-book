# AI 智能荐书：现状诊断与实施路线图

> 受众：接手推荐/统计/画像相关工作的开发者与 AI Agent。
> 更新频率：事件驱动（推荐链路结构调整、注入策略变更、画像模型变化时更新对应小节）。
> 原则：本文所有断言均带 `文件:行号` 证据，且以当前工作区代码为准；标"推断"的尚未实机验证。
> 上次核对：2026-09-18。

---

## 1. 当前推荐链路全图（已验证）

```mermaid
graph LR
    A[AIAdvisor.tsx:121<br/>只发 library+history] --> B[POST /api/ai/recommend/stream<br/>ai.ts:261]
    B --> C[buildLibraryOverview<br/>libraryTools.ts:1081]
    C --> D[callAgentStream<br/>aiService.ts:614]
    D --> E[Phase 1 工具循环<br/>≤3 轮 非流式]
    E --> F[Phase 2 流式生成 JSON]
    F --> G[SSE: phase/tool_call/reasoning/chunk/done]
    G --> H[前端渲染 AdvisorResult<br/>AIAdvisor.tsx:334-510]
    H -->|仅 externalMatches| I[App.tsx:181 造 Book<br/>status=UNREAD → /api/books/batch]
```

关键事实：

| 环节 | 实现位置 | 事实 |
|------|---------|------|
| 请求载荷 | `services/geminiService.ts:165-178`、`components/AIAdvisor.tsx:121-127` | 只发 `userRequest` / `userMood` / **全量 `library`** / `conversationHistory`；**不发 `userProfile`、不发 `categoryContext`** |
| Schema 能力 | `backend/src/routes/ai.ts:120-156` | `recommendSchema` **已支持** `userProfile`、`categoryContext`（optional），前端从未填 |
| 常驻注入 | `aiService.ts:1290` → `libraryTools.ts:1081-1163` | 每次请求注入：总量/状态分布、分类分布、难度分布、评分统计、紧凑品味画像、在读书详情、最近读完 5 本、**≤100 本时全量书库索引**、工具清单文字 |
| 可选注入 | `aiService.ts:1292-1314` | 【用户画像】【分类上下文】两段拼接逻辑完整，**当前恒为空** |
| Agent 循环 | `aiService.ts:649,653-726` | `MAX_ROUNDS = 3`，Phase 1 非流式，工具结果按 `toolName:args` LRU 缓存（`libraryTools.ts:42-78`），写工具不缓存（`:81-83`） |
| 落库 | `App.tsx:181-202` | 仅"新书建议"可一键入库为 `UNREAD`；"书库匹配"不写回；`types.ts:1-4` 的 `BookStatus` **没有"想读"状态** |

**结论：`libraryTools.ts:5-6` 注释所述"概览常驻 + 明细工具查"的混合策略已经落地。当前推荐质量的瓶颈不在"注入不够"，而在①画像数据线是死的、②注入内容与规模未分级、③没有任何反馈闭环能判断改动是否更好。**

---

## 2. 什么算"真正智能推荐"：分级标尺

| 级别 | 判据 | 现状 |
|------|------|------|
| L0 关键词匹配 | 书名/分类字面相似 | 已超越 |
| L1 概览感知 | 模型看得到总量、分类、难度、在读 | **当前所处**（`buildLibraryOverview` 已满足） |
| L2 个体画像 | 模型看得到"这个人的稳定特征"：水平、目标、偏好、盲区、笔记 | **卡在门口**：注入代码存在但输入永远为空（见 O1） |
| L3 证据驱动 | 推荐理由可指回具体证据（"你在读《X》卡在进度 30%""你 3 本认知科学都没读完"） | 部分达成：工具能查，但理由无法溯源到阅读史 |
| L4 闭环校准 | 采纳/搁置/读完/评分回流，成为下次排序信号，推荐命中率可度量 | **完全缺失**，这是与"智能"之间的唯一硬缺口 |

**要走到 L4，缺的不是更大的 prompt，而是可度量的评估集与采纳信号。**

---

## 3. 四项优化

### O1 接通用户画像链路（P0，最高杠杆）

**证据**
- 后端读端点在：`backend/src/routes/profile.ts:19`（`GET /`）、`:108`（`category-meta`），且 `:13` 已挂 `requireAuth`。
- 前端客户端方法在：`services/bookService.ts:61-79`（`fetchProfile` / `saveProfile`），**全仓无调用方**。
- 因此 `context.userProfile === undefined` → `aiService.ts:1292` 分支永不进入 → `get_user_profile` 工具永远返回 `{ error: '用户尚未设置画像信息' }`（`libraryTools.ts:547-550`）。

**根因**：画像的存储层与调用层都写了，中间那段"何时写、何时读、由谁填"没有接。历史上 `UserProfilePanel.tsx` 是画像编辑入口，已作为废弃组件删除，而 `AIAdvisor` 未接管取数。

**方案**
1. 应用启动/登录后加载一次画像，存入前端状态（复用 `useBookLibrary` 的加载时机，`App.tsx:33-73`）。
2. `AIAdvisor.tsx:121` 的请求体补 `userProfile`；`categoryContext` 在"从某分类进入顾问"的场景补上（schema 已就绪，零后端改动）。
3. 画像编辑入口回归：设置页一个轻量表单（水平/目标/偏好/每日时长），不做独立面板。
4. `aiAnalysis`（推断水平、盲区、建议方向）由 `/api/ai/profile/stream`（`ai.ts:459`，当前前端零调用）生成后回写 `user_profiles`，形成"分析→持久化→注入"的闭环，而不是每次让模型重新猜。

**验收标准**
- `get_user_profile` 工具在真实请求中返回对象而非 error；SSE 的 `tool_call` 事件里可见。
- 后端日志中 `userPrompt` 含【用户画像】段（可临时打印长度验证）。
- 同一 query 在改画像前后，推荐理由发生可观察变化（人工比对，非形式测试）。

**成本/风险**：约 1 个组件 + 2 处接线；风险是画像过期误导模型 → 注入时带 `lastUpdated`，超过 N 天标注"画像可能过时"。

---

### O2 常驻上下文重构：从"全量倾倒"到"分层注入"（P0）

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

**验收标准**
- 构造 79 / 81 / 301 本三套书库，概览长度、首行档位声明、工具调用次数均按预期变化（脚本比对，不落 AI 依赖）。
- 单次推荐请求的 prompt token 相对基线下降 ≥25%，且人工评分不降。

**成本/风险**：集中在一个函数，中等；风险是削减注入后模型"看不全"→ 用档位声明 + 保留搜索工具兜底。

---

### O3 统计口径归一 + 数据可信度（P1）

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

### O4 移动端可用性（P1，成本低、确定性高）

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

1. **采纳反馈闭环**：新增 `recommendations` 表记录 `(用户, query, 推荐书目, 角色=主书/补充/放松, 是否入库, 后续是否在读/读完, 评分)`。
   - 建表安全：`CREATE TABLE IF NOT EXISTS` 对新表有效；**改已有表列不会生效**（无迁移系统，见 ARCHITECTURE §6），需手工 `ALTER TABLE` 或提示删库重建。
   - 有了它，`get_reading_gaps` / 品味画像才能从"书名分布"升级为"被验证过的偏好"。
2. **评估集**：固定 20–30 条 query（覆盖明确目标/模糊心情/跨类/难度不适配/续读五类），每次改 prompt 或注入策略跑一遍，按相关性·多样性·难度适配三维人工打分。没有它，O1/O2 的"变好了"只是感觉。
   - 现成可复用的调用样例：`backend/test-recommend-stream.js`、`test-stream.js`。
   - **红线**：这类脚本直连真实 AI API 会消耗 token，运行前须说明并征得同意。
3. **状态语义**：`types.ts:1-4` 缺"想读"，导致推荐采纳只能落成 `UNREAD`，与"未读的书"混在一起，读历史信号被污染。

---

## 5. 已建未接的能力（不是新需求，是接上线）

后端有端点、前端零调用（证据来自 `backend/src/routes/ai.ts`）：`/category-advice:178`、`/reading-path:232,311`、`/reading-insights/stream:413`、`/profile/stream:459`、`/compare-books/stream:491`、`/reading-summary/stream:545`、`/notes/stream:583`。
另有一处**静默丢弃**：AI 工具写库产生的 `book_update` 被转成 `aiBookUpdate` 自定义事件（`ReadingAssistant.tsx:98-101`、`BookQA.tsx:137-139`），但全仓没有 `addEventListener('aiBookUpdate')`，且 `StatsView.tsx:319` 未传 `onBookUpdate` —— 模型说"已把你标记为读完"，界面与实际数据都没变。这条要么接通，要么禁止模型承诺写操作。

无引用 hooks：`hooks/useAIRequest.ts`、`useAIStreaming.ts`、`useDebounce.ts`（后者与 `App.tsx:79-110` 的手写防抖重复）。

---

## 6. 建议顺序与阶段 DoD

| 阶段 | 内容 | DoD（可验证） |
|------|------|--------------|
| S1 | O1 画像接线 + §5 的 `aiBookUpdate` 断线 | 工具返回真实画像；AI 改状态后界面与 DB 一致 |
| S2 | O2 分档注入 + 删冗余 | 三套规模书库行为符合预期；prompt token ≥25% 下降 |
| S3 | O3 统计归一（含 `sort` 与热力图） | 页面数字与概览数字逐项相等 |
| S4 | O4 移动端 6 项 | 四档断点主路径人工通过 |
| S5 | O5 反馈表 + 评估集 | 拿到第一次基线分数，此后每次 prompt 改动必须报分差 |

S1/S2 决定推荐"像不像懂你"，S5 决定"能否持续变好"。S3/S4 是使用面信任与触达。

---

## 7. 非目标（本轮明确不做）

- 不做协同过滤/向量召回/嵌入检索等推荐系统基建：个人书库场景下信号量不足以喂饱，优先吃掉画像与闭环收益。
- 不做多模型 A/B 平台、不做在线学习。
- 不重构 `aiService` 的两阶段架构（11s 首字节阻塞已由"Phase 1 实时推 reasoning + 跳过冗余 Phase 2"解决，见 commit `855fc04`），只在注入内容上做文章。
- 不为凑齐"测试通过"新建 ESLint/单测脚手架：本仓库现状是无测试、`npm run lint` 无配置（ARCHITECTURE §6），如实报告即可。

## 8. 验证手段（本项目的现实约束）

唯一自动化门槛 = `npm run build`（根，vite）+ `cd backend && npm run build`（tsc）。
其余一律人工：`backend/test-*.js` 冒烟、浏览器实机走主路径。推荐质量属主观效果，**必须靠 §4 的评估集人工打分**，不要以"构建通过"冒充"推荐变好了"。
