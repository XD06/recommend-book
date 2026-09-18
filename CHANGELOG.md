# 更新日志

本文件记录面向使用者的功能变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按时间段组织（项目尚未打正式版本 tag）。

## [未发布]

自上一提交以来已落在仓库、但尚未发版的改动：

### 新增
- `docs/AI-RECOMMENDATION-ROADMAP.md`：AI 荐书链路诊断与路线图（画像链路断点、常驻注入分档、统计口径归一、移动端缺陷、采纳反馈闭环与评估集），逐条附 `文件:行号` 证据与验收标准

### 变更
- UI 组件重构：新增 `ConfirmDialog` 确认对话框组件，移除未使用的 `CategoryAdvisor`、`FallbackCover`、`Input`、`LibraryTable`、`Sidebar`、`UserProfilePanel` 等废弃组件
- 后端认证、书库、豆瓣路由与提示词同步调整
- 文档体系重建：README / ARCHITECTURE / CHANGELOG 按当前代码重写，历史版本移入 `docs/archive/`，参考资料移入 `docs/`
- 文档校正（对照源码逐条核实，未改任何代码）：鉴权范围改为"books/profile/ai/douban 均需 requireAuth，仅 register/login/health 免鉴权"；说明 Zod 校验仅 `ai.ts` 有 `validate` 中间件、`douban.ts` 多数端点未校验；`DOUBAN_PROXY_URL` 代码默认值为空（示例值仅在 `.env.example`）；区分豆瓣搜索（始终走网络）与详情（缓存 + 必需 Python，无 Node 兜底）两条链路；SSE 解析归属 `services/geminiService.ts` 而非 `useAIStreaming`；前端构建实测耗时与 chunk 体积

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
