# DeepRead

AI 驱动的个人阅读管理系统：把一份原始书单变成结构化的书库——自动搜索豆瓣书目数据、AI 生成分类 / 难度 / 解读、提供个性化推荐（主书 + 补充 + 放松三层）、阅读进度追踪，以及可对话的 AI 阅读顾问（书籍问答、笔记整理、读书总结、阅读洞察）。

支持多用户注册登录，数据存储在本地 SQLite，无需安装任何数据库服务。

## 快速开始

前置要求：Node.js ≥ 20；Python 3 可选（启用豆瓣直接抓取兜底，见下）。

```bash
# 1. 启动后端（端口 3001）
cd backend
npm install
cp .env.example .env        # Windows cmd 用 copy 命令
# 编辑 backend/.env，至少配置 DEEPSEEK_API_KEY（或 LITELLM_BASE_URL 等）
npm run dev                 # API Base: http://localhost:3001/api

# 2. 启动前端（另开一个终端，端口 5173）
cd ..
npm install
npm run dev                 # 页面: http://localhost:5173
```

Windows 下也可以直接双击根目录的 `start.bat` 一键启动前后端（`stop.bat` 一键停止）。

可选的豆瓣抓取兜底依赖 Python 环境：

```bash
pip install aiohttp beautifulsoup4 lxml
```

未安装 Python 时的降级范围：搜索仍可用（后端走代理或直连豆瓣 suggest 接口），但**缓存未命中的书籍详情抓取会失败**——详情抓取由 `douban_mini` 的 Python 抓取器承担，Node 侧没有兜底实现。

## 技术栈

- **前端**：Vite + React 18 + TypeScript（strict）+ Tailwind CSS，动画用 motion，图标用 Phosphor / Lucide
- **后端**：Node.js + Express + TypeScript，SQLite（better-sqlite3，零安装文件型数据库），JWT 认证，Zod 请求校验
- **AI**：DeepSeek API 或任意 OpenAI 兼容网关（LiteLLM），全链路 SSE 流式输出
- **豆瓣数据**：外部豆瓣代理 + 本地 Python 抓取器（`douban_mini/`）+ 文件缓存

## 项目结构

```
App.tsx / index.tsx      前端入口与应用骨架（代码在仓库根目录，不在 src/）
components/              React UI 组件
services/                前端 API 客户端（authService / bookService / geminiService）
hooks/                   流式状态、打字机、防抖等 React Hooks
utils/                   纯函数工具（书名去重）
backend/                 Express 后端（routes / services / prompts / db）
  └ eval-advisor.js      AI 荐书评估台：隔离运行 + 前后对比（见下）
  └ eval-queries.json    评估集（明确目标 / 模糊心情 / 难度 / 跨类 / 续读 / 站外 / 闸门）
douban_mini/             Python 豆瓣抓取器（依赖 aiohttp + beautifulsoup4 + lxml）
docs/                    项目文档与归档
```

## 推荐质量怎么验证

`npm run build` 只能证明代码能编译，**证明不了"推荐变好了"**。为此仓库带了一个评估台：

```bash
cd backend && npm run build
node eval-advisor.js --run --tag=baseline --model=step-3.7-flash   # 会真实计费
#   改代码、重新 build 之后
node eval-advisor.js --run --tag=after --model=step-3.7-flash
node eval-advisor.js --compare=baseline,after                      # 不发请求、不花钱
```
它按"三点隔离"跑：库换成 `VACUUM INTO` 快照、模型名由 env 覆盖、登录态现签 JWT，全程在 `backend/.eval-run/<tag>/` 下，**不碰你正在用的库与 `backend/.env`**，也不与 `:3001` 的实例冲突（用 3999）。不传 `--run` 只会打印用法 —— 这类脚本直连真实 AI，跑之前请确认要花这笔 token。

另外两个**零 token**的离线用例，改完相关代码随手就能跑：

```bash
node check-validation.js           # 推荐输出的清洗：幻觉 bookId 修复/丢弃、站外推荐与书库去重
node check-profile-provenance.js   # 画像来源：用户填写不被 AI 覆盖、同值跳过、来源升级
node inspect-context.js            # 本次请求到底往模型里塞了什么：逐段字符数、工具清单、闸门状态
```

**想看 agent 的全貌**（一次请求的 9 步、能力边界、哪些端点没接线）：打开 [docs/agent-map.html](docs/agent-map.html)。`inspect-context.js` 与线上请求共用同一个 `buildAdvisorPrompt()`，所以它报的数字与真实请求一致。

**关于画像：AI 不会覆盖你自己填的，而且它记的东西可以撤。** 用户在设置页填的、或用户在对话里明确说过的字段，记为"用户来源"，AI 只能沿用不能改写；AI 从对话里记录的字段会标注"可能是推测"并附带依据（用户原话），只填空白字段。设置页的「这些信息从哪来」可以逐字段核对，「画像改动历史」可以逐条撤销（值的前后对比、来源、依据、时间都在）。

**AI 怎么记东西（两条路，都不依赖模型自觉）**：① 对话中它自己判断要不要调 `update_user_profile`（尾部指令 + 落盘闸门兜底）；② 回答完之后再跑一次**回合后异步抽取**（`POST /api/ai/profile/extract`）——只问"用户这句话里有没有稳定的画像信息"，闲聊直接跳过、不花任何调用。走②记下的内容会在对话里当场弹「AI 记住了…（撤销）」，撤销后值和来源一起还原。


## 环境变量

- 后端：见 [`backend/.env.example`](backend/.env.example)（API Key、JWT 密钥、CORS、限流、缓存等）
- 前端：见 [`.env.example`](.env.example)（仅 `VITE_API_BASE` 一个变量，默认指向 `http://localhost:3001/api`）

不要把 `.env` 提交进仓库（已在 `.gitignore` 中）。

## 常见问题

**AI 功能报 `fetch failed`（前端显示"抱歉，回答时出了点问题"）**

后端日志会看到 `Agent round 1 调用失败: fetch failed`。这通常不是 Key 或代码问题，而是 Node 没走你本机的代理：Node 18+ 的全局 `fetch` 默认**不读** `HTTP_PROXY` / `HTTPS_PROXY`，而靠本地代理出网的机器上，DNS 常把外网域名解析成 `127.x.x.x` 占位地址，直连必然 `ECONNREFUSED`（`curl` 因为读代理变量所以是通的，容易误判成"网络没问题"）。

```bash
# 后端启动时带上这个变量，Node 的 fetch 就会像 curl 一样读代理环境变量
NODE_USE_ENV_PROXY=1 npm run dev     # macOS / Linux
set "NODE_USE_ENV_PROXY=1" && npm run dev   # Windows cmd（start.bat 已内置）
```

自查命令：`node -e "require('dns').lookup('你的 LLM 域名',{all:true},(e,a)=>console.log(e||a))"` —— 返回 `127.x` 或 `ECONNREFUSED` 就是这个坑。

## 相关文档

- 架构说明：[ARCHITECTURE.md](ARCHITECTURE.md)
- 更新日志：[CHANGELOG.md](CHANGELOG.md)
- AI 协作规范：[AGENTS.md](AGENTS.md)（本地文件，不入库）
- AI 荐书诊断与路线图：[docs/AI-RECOMMENDATION-ROADMAP.md](docs/AI-RECOMMENDATION-ROADMAP.md)
- 参考资料：[docs/将AI-Agent嵌入App的三层架构指南.md](docs/将AI-Agent嵌入App的三层架构指南.md)
- 历史文档归档：[docs/archive/](docs/archive/)（本地文件，不入库）
