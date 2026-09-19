# 更新日志

本文件记录面向使用者的功能变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按时间段组织（项目尚未打正式版本 tag）。

## [未发布]

自上一提交以来已落在仓库、但尚未发版的改动：

### 新增
- 阅读画像真正接入推荐链路：设置页新增「阅读画像」表单（阅读水平 / 目标 / 每日时长 / 偏好分类），`App.tsx` 挂载时拉取 `GET /api/profile` 并透传给 AI 顾问与阅读管家。此前画像接口与后端 `【用户画像】` 注入逻辑都在，但前端从未请求，AI 侧画像段与 `get_user_profile` 工具恒为空
- `GET /api/profile/stats` + `backend/src/services/libraryStats.ts`：统计口径收敛为单一实现，`buildLibraryOverview`（发给模型的概览）、`get_category_stats` 工具与统计页共用
- `docs/AI-RECOMMENDATION-ROADMAP.md`：AI 荐书链路诊断与路线图（画像链路断点、常驻注入分档、统计口径归一、移动端缺陷、采纳反馈闭环与评估集），逐条附 `文件:行号` 证据与验收标准

### 变更
- AI 写库回传接通：`/api/ai/recommend/stream`、`/api/ai/book-qa/stream` 补发 `book_update` 事件（原先这两处传的是 `undefined`，只有全局阅读管家有），`AIAdvisor`/`BookQA` 派发 `aiBookUpdate`，`App.tsx` 监听后落库并同步已打开的书籍详情。此前模型说"已标记读完"，界面与数据库都不变
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
- 刷新时整页闪一圈黑框：`Ctrl+R` 属键盘操作，Chrome 重新加载后把焦点还给文档，`<body>` 随即命中 `:focus-visible`；而 body 恰好撑满视口（实测 441×685 == viewport），UA 默认描边就沿屏幕四边画出来。dev 模式下 Tailwind 样式由 JS 注入、晚于首帧，注入后才被 `outline: transparent` 覆盖，所以表现为"闪一下"。现将 `styles.css` 的 `:focus-visible` 拆成"`outline:none` 兜底 + 光环只给控件"，并显式排除 `html/body/#root`；`index.html` 的 head 内联样式补一条 `html:focus-visible, body:focus-visible { outline: none }`，首帧即生效
- 加载屏的转圈动画不可见：`App.tsx` 两处加载屏与 `components/Spinner.tsx` 的 `lg` 档用了 `border-3`，而 Tailwind 的 borderWidth 档位只有 0/1/2/4/8，该类不生成任何规则，于是 `border-zinc-200 border-t-zinc-900` 全挂在 0 宽边框上，只剩文字。改为 `border-[3px]`（与 `Spinner` 的 `md` 档 `border-[2.5px]` 同一写法）
- AI 顾问对"你好"这类寒暄直接输出整份书单：`readingAdvisor` 系统提示 370+ 行里模式判定写在中间，而 `getRecommendationsStream` 传给 `withTools` 的 extraHint 尾句又写着"直接给出推荐"，弱模型按尾部惯性跳过判定。现把模式闸门移到用户提示词最后一条（流式与非流式两条路径同步），并把该尾句改为"直接回答即可，寒暄或笼统请求按对话模式简短回应、不要输出书单"
- 后端经本地代理出网时 AI 全量 `fetch failed`：Node 的全局 `fetch` 默认不读 `HTTP_PROXY` / `HTTPS_PROXY`，而此类机器上 DNS 会把 LLM 域名解析成 `127.x` 占位地址，直连必 `ECONNREFUSED`（`curl` 读代理所以是通的，易误判为"网络正常"）。`start.bat` 现内置 `NODE_USE_ENV_PROXY=1`，README 补自查方法

### 移除
- 清理无引用的遗留文件：localStorage 时代调试页 `check-storage.html`、`clear-storage.js`、开发用 mock 数据、书单种子 `titles.txt`
- `cache.json` 与 `backend/data/user-douban-cache.json` 停止 git 追踪（本地文件保留，运行时自动生成/使用；缺失时由实时抓取接管，但详情抓取需本机 Python），`.gitignore` 补充 `backend/data/` 目录

## [2026-08-08 ~ 2026-08-19] 多用户与 AI Agent 阶段

### 新增
- 用户注册 / 登录系统，书库数据从 localStorage 迁移到 SQLite 数据库，升级为多用户应用；旧用户首次登录自动迁移本地数据
- AI Agent 系统：AI 顾问可通过工具自主查询书库（搜索、详情、分类统计、阅读历史、品味画像、知识缺口等 9 个工具），并支持直接更新阅读状态
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
