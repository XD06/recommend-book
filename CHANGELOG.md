# 更新日志

本文件记录面向使用者的功能变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按时间段组织（项目尚未打正式版本 tag）。

## [未发布]

自上一提交以来已落在仓库、但尚未发版的改动：

### 新增
- 阅读画像真正接入推荐链路：设置页新增「阅读画像」表单（阅读水平 / 目标 / 每日时长 / 偏好分类），`App.tsx` 挂载时拉取 `GET /api/profile`。此前画像接口与后端 `【用户画像】` 注入逻辑都在，但前端从未请求，AI 侧画像段与 `get_user_profile` 工具恒为空。（透传给 AI 组件这一段已被后续改动取代：画像改由后端在流式端点内直读 SQLite，见「变更」首条；`App.tsx` 的拉取仍保留，供设置页表单使用）
- `GET /api/profile/stats` + `backend/src/services/libraryStats.ts`：统计口径收敛为单一实现，`buildLibraryOverview`（发给模型的概览）、`get_category_stats` 工具与统计页共用
- `docs/AI-RECOMMENDATION-ROADMAP.md`：AI 荐书链路诊断与路线图（画像链路断点、常驻注入分档、统计口径归一、移动端缺陷、采纳反馈闭环与评估集），逐条附 `文件:行号` 证据与验收标准
- **`update_user_profile` 写工具**（Agent 工具从 9 个增至 10 个）：对话中问出来的阅读水平 / 目标 / 每日时长 / 偏好分类能落回 `user_profiles` 表，写后立即刷新 `ctx.userProfile` 并清空工具缓存，让同一次请求的后续工具读到新值。此前 Agent 只能"这一场记住"，会话结束就蒸发、下次冷启动重新问一遍——那是"AI 主动询问用户"这条产品路径唯一的硬断点。字段按 patch 语义只更新用户明确说过的，`preferredCategories` 是覆盖式更新（提示词与工具描述里都写明了）
- **推荐采纳反馈入口**：新表 `recommendation_feedback` + `POST/GET /api/ai/recommend-feedback`，AI 顾问的每条推荐（书库匹配与新书建议都算）挂「想读 / 跳过」按钮，点击即记录，失败会回滚按钮状态。`requestId` 由前端在发起请求时生成、贴在本次结果对象上，点按钮时随反馈请求一起 POST，用于把同一次请求的展示与点击归组（服务端不生成它，也不持久化 query 本身）。口径要留意：**只记显式点击、不记"展示了哪些"**，所以现在能算"点了什么"的分布，还算不出严格采纳率（缺分母）
- **书库硬闸门**：模型这一轮一次书目查询都没做、却给出非空 `libraryMatches` 时，后端追加 1 轮重问，提示词直指"这些 bookId 无从核对，先查书库；查完确实没有就把 `libraryMatches` 留空、改用 `externalMatches` 并如实说明"。此前"推荐前必须先查书库"只写在 370 行系统提示的中间，属劝导，弱模型会跳过判定、凭记忆报书名和 ID。闸门只在书库 >100 本时启用（≤100 本概览里本来就是全量 `[id] 书名`，不查工具也算有据可依），判据限定为"声称推了书架上的书"，寒暄回复不会被拖去多花一轮

### 变更
- AI 写库回传接通：`/api/ai/recommend/stream`、`/api/ai/book-qa/stream` 补发 `book_update` 事件（原先这两处传的是 `undefined`，只有全局阅读管家有），`AIAdvisor`/`BookQA` 派发 `aiBookUpdate`，`App.tsx` 监听后同步内存副本与已打开的书籍详情。此前模型说"已标记读完"，界面与数据库都不变。（"落库"这一环已被后续改动移到服务端，客户端监听器现在只负责让自己的副本跟上数据库，见「变更」首条）
- **Agent 的书库真源改为 SQLite**：全部 `/api/ai/*/stream` 端点不再从请求体接收 `library` / `userProfile`，后端按登录用户用 `createAgentContext(req.user.id)` 直接从 `books` 表载入。此前客户端把自己那份内存副本当成"书库"交给模型，Agent 看到的是快照而非数据，`update_book_status` 也只改副本、要靠客户端下一次全量保存才落得了库（客户端漏接事件就永远落不了）。现在读写都命中数据库，写后立即失效本请求的工具缓存让后续工具读到新值。流式请求体随之从"整份书库"降到 KB 级，`[AI] ✓ body parsed` 日志改为只报体积——体积异常回升就说明客户端又开始传全量库。仍走请求体的只剩"用户在界面勾选的那批书"（阅读路径的 `books`、分类/整理的 `titles`），那是请求参数不是书库
- **`book_update` 语义反转**：从"通知前端去写库"变成"通知客户端它那份副本已过期"。全部流式端点统一接上该回调（`routes/ai.ts` 内新增 `sseHandlers()` 集中接线），`BookDetail` 的 AI 解读此前漏接——模型改了状态会被详情页随后触发的全量保存冲掉，现已补齐。前端相应移除传给 AI 组件的 `library` / `userProfile` props 与层层透传
- **工具缓存与 Web 用量改为请求作用域**：`toolResultCache` 与 Exa 的会话调用计数原是模块级全局，多用户共用一个后端进程时会跨用户命中缓存、调用配额跨请求累计消耗；现挂在 `AgentContext` 上随请求生灭
- **`callAgentStream` 的 13 个位置参数收敛为一个 options 对象**：`onBookUpdate` 一类回调原先靠位置对齐传入，调整签名要改全部调用点且传错顺序不会报错；现为具名字段
- **修复 `/api/ai/recommend/stream` 的对话历史重复注入**：历史既被 `buildReadingAdvisorUserPrompt` 以文本形式内联进用户提示，又被当作结构化 `messages` 发给模型，同一段对话占两份上下文。现只保留结构化一份
- **修复前端 SSE 解析吞掉后端错误**：`services/geminiService.ts` 原先把帧解析与回调分发写在同一个 `try` 里，只放行"不含 JSON 字样"的错误，于是后端 `error` 事件抛出的错误常被静默丢弃，界面只剩一句通用失败提示。现 `catch` 只覆盖单帧解析失败，回调与 `error` 事件的异常一律向外传播
- **推荐输出改为服务端校验后再回客户端**：新增 `backend/src/services/recommendValidation.ts`，`/api/ai/recommend/stream` 的 `libraryMatches` 逐条与真实书库对齐——`bookId` 对得上就保留，对不上按归一化书名唯一反查修复（剥《》与版次标记，同名多本不猜、模糊匹配也只认唯一命中），修不掉才丢弃；`kept / repaired / dropped / droppedTitles` 作为 `matchValidation` 随响应回传，界面在真有过滤时提示"已过滤 N 条"并列出书名。此前前端只有 `if (!book) return null;`，一个幻觉 ID 会让"模型推了 3 本"在界面上静默变成"推了 2 本"，用户以为模型没推、开发者以为推了。清洗之所以有效，是因为客户端渲染的是 `done` 事件里这份返回值而非 chunk 流。非流式 `/recommend` 未接（它的书库来自请求体，没有服务端真源可对齐），该端点本就无前端调用方
- **设置页画像保存改为只发自己那四个字段，并在进入设置页时重拉画像**：此前 `handleSaveProfile` 会把挂载时那份快照整体展开后 PUT，而快照一辈子只拉一次——AI 通过 `update_user_profile` 刚写进去的偏好，用户随手点一次"保存画像"就按旧值冲回去了。现在表单不展开旧快照、进页时重新 `GET /api/profile`，两条写入路径不再互相覆盖
- 常驻注入按书库规模分档并显式声明覆盖范围：≤100 本完整索引、101–300 本节选（全部在读 + 最近读完 + 各分类最新 3 本）、>300 本不注入书名；同时删除与系统提示重复的工具清单提示行
- 阅读统计页数字改为取自后端统计接口；热门分类不再对 props 数组做原地 `sort`
- 阅读热力图去掉 `Math.random()` 模拟的"每日阅读活动"，改为按 `startDate` / `completionDate` 真实事件计数，月份标签按实际窗口生成
- 移动端可用性：底部导航改用已定义的 `pb-safe`（原 `safe-area-pb` 类名不存在，iPhone 手势条压住 tab）；窄屏保留「添加书籍」图标入口；书库侧栏 <1024px 由隐藏改为可折叠区块；设置页统计格改响应式；AI 对话区固定高度改 `60vh` + 上下限；Toast 窄屏不再溢出；书籍详情标签栏支持横向滚动
- 桌面端 AI 顾问正文限制阅读行宽（顾问洞察与对话气泡改 `max-w-prose`），此前一行可拉到 1200px 以上，中文长文难以换行定位
- AI 顾问容器由 `max-w-4xl` 收窄为 `max-w-3xl`，根容器改 `min-h-[100dvh]` + `pt-[var(--top-nav-h)]` + `pb-[var(--bottom-nav-h)]`（原 `min-h-[calc(100dvh-8rem)]` 里的 8rem 与实际导航高度无关）；心境胶囊窄屏改单行横向滚动（不再折成两行顶高输入区）；设置页 3xl 内容列改水平居中（此前贴左，宽屏右侧大片空白）
- UI 组件重构：新增 `ConfirmDialog` 确认对话框组件，移除未使用的 `CategoryAdvisor`、`FallbackCover`、`Input`、`LibraryTable`、`Sidebar`、`UserProfilePanel` 等废弃组件
- 后端认证、书库、豆瓣路由与提示词同步调整
- 文档体系重建：README / ARCHITECTURE / CHANGELOG 按当前代码重写，历史版本移入 `docs/archive/`，参考资料移入 `docs/`
- 文档校正（对照源码逐条核实，未改任何代码）：鉴权范围改为"books/profile/ai/douban 均需 requireAuth，仅 register/login/health 免鉴权"；说明 Zod 校验仅 `ai.ts` 有 `validate` 中间件、`douban.ts` 多数端点未校验；`DOUBAN_PROXY_URL` 代码默认值为空（示例值仅在 `.env.example`）；区分豆瓣搜索（始终走网络）与详情（缓存 + 必需 Python，无 Node 兜底）两条链路；SSE 解析归属 `services/geminiService.ts` 而非 `useAIStreaming`；前端构建实测耗时与 chunk 体积

### 修复
- 移动端 `fixed` 底部导航遮挡内容：AI 顾问的吸底输入区（`sticky bottom-0` 正好压在导航下面，心境条与输入框点不到）、统计页右下角悬浮管家按钮、统计页与设置页尾部留白不足。统一由 `styles.css` 的 `--bottom-nav-h`（导航实高 4.5rem + 手势条安全区，`viewport-fit=cover` 已开）驱动避让，桌面端 `md:` 覆盖后不受影响
- 顶部 `fixed` 导航压住页面标题：AI 顾问对话态只有 `pt-4`（16px），而导航实高 88px，图标块与标题被压在下面；其余页面各自硬写 `pt-20`（80px）也差 8px，且 `viewport-fit=cover` 下刘海区域完全不避让。新增 `--top-nav-h`（5.5rem + `safe-area-inset-top`），书库/统计/设置/导入向导/AI 顾问五个入口统一改用它，导航本身改为 `top-[env(safe-area-inset-top)]`
- AI 顾问空状态"标题贴顶 + 输入区贴底 + 中间一大片空白"：空状态改为整屏垂直居中，并补上快捷提问与真实在读进度两块内容；对话态移除页面标题与活动面板里重复的"AI 阅读顾问"标签（每条回复自带机器人头像）
- 刷新时整页闪黑框的**原根因判定已被推翻**（原记录：`Ctrl+R` 属键盘操作 → `body` 命中 `:focus-visible` → UA 默认描边沿视口四边画出）。所保留的加固本身仍然有效且照旧生效：`styles.css` 的 `:focus-visible` 拆成"`outline:none` 兜底 + 光环只给控件"、显式排除 `html/body/#root`，`index.html` head 内联补 `html:focus-visible, body:focus-visible { outline: none }` 首帧即生效。但它治的不是现在这个现象，见下一条
- 【已定位、未修复】刷新时内容区顶部闪一条 **24px 高的纯黑横带**。像素定位（用户提供的全窗口截图，2239×1399，无色彩偏移）：y=131–154 全宽 `(0,0,0)`，y≥155 起才是页面自身的 `#fafafa`（`index.html:9` 内联），y≤128 是 Chrome 工具栏白、y=129 是 1px 分隔线；**左右两侧无任何暗列**（故不是"四边一圈"）。页面侧因素逐项排除：登录态（DOM 节点 42→2082）逐帧扫描 385 帧，覆盖 ≥60% 视口的元素中深色 outline/border/box-shadow/bg **0 命中**；head 内联样式最早可绘帧（t=3ms、sheets=1）即已生效；`body` 的 computed `outline-style` 全程为 `none`；鼠标点刷新、无痕窗口、关闭图形加速、生产构建 `npm run preview`、`about:blank`/其他站点五种条件**全部仍闪**。再在受控浏览器里做高帧率复现，**两次都没复现**：Playwright Chromium（全新临时 profile、无扩展）20fps × 3 次 reload × 239 帧 0 命中；本机正式版 Google Chrome（`--start-maximized`、全新 profile、dpr 1.5、内容区上沿偏移实测 134 device px）在 400×80 取样块上 **59fps × 3 次 reload × 754 帧 0 命中**（判据：单行 ≥90% 像素亮度 <40）。结论收窄：与 DeepRead 代码无关，也不是本机 GPU/通病的必然表现，而是**用户那个 Chrome 配置档的状态**——无痕窗口已排除普通扩展，但 **Chrome 主题与 `chrome://flags`（尤其 Auto Dark Mode）在无痕下照旧生效**，正好落在"无痕仍闪 / 干净 profile 不闪"这条分界线上。用户侧下一步按代价排序：① 访客窗口（干净 profile、无主题无扩展）里刷新是否还闪，5 秒定论；② `chrome://settings/appearance` 主题改回默认；③ `chrome://flags/#enable-dark-mode` 恢复 Default；④ 要像素证据就跑 `powershell -File strip-capture.ps1 -OutDir userflash -Ms 8000 -Delay 1500 -Y 60 -H 300 -W 500`，期间连按两次 `Ctrl+R`。原先记的两条缓解实验（加 `<meta name="theme-color">`、去掉 `viewport-fit=cover`）**不再必要**：它们改的是页面，而页面侧已被排除
- 加载屏的转圈动画不可见：`App.tsx` 两处加载屏与 `components/Spinner.tsx` 的 `lg` 档用了 `border-3`，而 Tailwind 的 borderWidth 档位只有 0/1/2/4/8，该类不生成任何规则，于是 `border-zinc-200 border-t-zinc-900` 全挂在 0 宽边框上，只剩文字。改为 `border-[3px]`（与 `Spinner` 的 `md` 档 `border-[2.5px]` 同一写法）
- 追问"上次推的那几本是什么"要多花一轮：`AIAdvisor` 拼对话历史时把书库推荐写成 `《${m.bookId}》`，书名 `m.title` 就在手边却没进字符串，喂给下一轮的"上次推荐了什么"是一串 UUID。实测同一句追问：只给 UUID 时模型要多调一次 `get_book_details` 反查（2 轮 / 10.6s），给书名则 1 轮 / 6.5s 直接答。改为 `《书名》[id:UUID]` —— 书名给回模型、ID 保留接地能力（历史里的 ID 已过服务端校验，可放心复用）。注意这不只是省时间：`MAX_ROUNDS=3` 用尽的那一轮里（413 本库上"从书架挑三本"实测恰好 round 3/3），反查那一轮根本不存在，模型只能猜
- AI 顾问对"你好"这类寒暄直接输出整份书单：`readingAdvisor` 系统提示 370+ 行里模式判定写在中间，而 `getRecommendationsStream` 传给 `withTools` 的 extraHint 尾句又写着"直接给出推荐"，弱模型按尾部惯性跳过判定。现把模式闸门移到用户提示词最后一条（流式与非流式两条路径同步），并把该尾句改为"直接回答即可，寒暄或笼统请求按对话模式简短回应、不要输出书单"
- 后端经本地代理出网时 AI 全量 `fetch failed`：Node 的全局 `fetch` 默认不读 `HTTP_PROXY` / `HTTPS_PROXY`，而此类机器上 DNS 会把 LLM 域名解析成 `127.x` 占位地址，直连必 `ECONNREFUSED`（`curl` 读代理所以是通的，易误判为"网络正常"）。`start.bat` 现内置 `NODE_USE_ENV_PROXY=1`，README 补自查方法

### 移除
- 清理无引用的遗留文件：localStorage 时代调试页 `check-storage.html`、`clear-storage.js`、开发用 mock 数据、书单种子 `titles.txt`
- `cache.json` 与 `backend/data/user-douban-cache.json` 停止 git 追踪（本地文件保留，运行时自动生成/使用；缺失时由实时抓取接管，但详情抓取需本机 Python），`.gitignore` 补充 `backend/data/` 目录

## [2026-08-08 ~ 2026-08-19] 多用户与 AI Agent 阶段

### 新增
- 用户注册 / 登录系统，书库数据从 localStorage 迁移到 SQLite 数据库，升级为多用户应用；旧用户首次登录自动迁移本地数据
- AI Agent 系统：AI 顾问可通过工具自主查询书库（搜索、详情、分类统计、阅读历史、品味画像、知识缺口等 9 个工具），并支持直接更新阅读状态（该工具数已随改动漂移，当前值见「未发布」的 `update_user_profile` 条）
- 书籍对比、读书总结、笔记整理、书籍问答、全局阅读助手、用户画像分析等 AI 功能
- 深度个性化推荐：阅读品味画像、知识缺口分析、推荐时机论证
- AI 顾问双模式：对话模式先理解需求，推荐模式再给建议；对话历史完整保留，支持续聊与快捷回复
- 科学阅读方法论融入推荐：主书 + 补充 + 放松三层推荐架构
- AI 推理过程（reasoning）实时推送与思考阶段可视化，流式文本预览、清空对话、输入框自适应

### 修复
- 消除 AI 调用约 11 秒的首字节阻塞（实时推送 reasoning + 跳过冗余的第二阶段调用）
- AI 请求 AbortSignal 误触发、空闲超时、暗色模式闪烁等问题
- 修复登录后卡在加载页、AI 解读生成失败等多个缺陷
- 新增 localStorage → SQLite 的一次性数据迁移，避免旧书库丢失

## [2026-07-09 ~ 2026-07-14] 后端化与豆瓣集成

### 新增
- 独立后端服务（`backend/`）：Express + TypeScript，豆瓣 API 代理（搜索、详情、封面、短评、智能查找 `/api/douban/find`）
- 豆瓣数据缓存优先策略（全局种子缓存 `cache.json` + 用户缓存），集成 `douban_mini` Python 抓取器作为兜底
- 视觉重塑为现代极简风格：全局 Toast 提示、书籍难度可视化（DifficultyBadge）、阅读统计视图（StatsView）、阅读时间线与热力图
- 书籍详情页新增豆瓣数据展示（评分、出版社、页数、短评）

### 修复
- 豆瓣数据字段名统一（`cover` → `cover_url`、`rating` → `rating_score`、`ratingCount` → `rating_count`），统一封面 URL 处理为代理格式优先
- `.env` 加入 `.gitignore`

## [2026-01-26 ~ 2026-01-28] MVP 创建

### 新增
- DeepRead MVP 项目初始化：React + Vite + TypeScript，书库管理基础交互
- AI 书籍分析：自动分类与子分类、难度评估、书籍解读
- 数据管理视图、个性化推荐 AI 顾问（AI Advisor）
- AI 服务从 Google Generative AI SDK 切换到 DeepSeek
