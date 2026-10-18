# 更新日志

本文件记录面向使用者的功能变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格，按时间段组织（项目尚未打正式版本 tag）。

## [未发布]

自上一提交以来已落在仓库、但尚未发版的改动：

### 新增
- **书库操作流水 `book_activities` + 阅读动态改为读流水**：新表记录 `added` / `started` / `finished` / `deleted` 四类事件，`GET /api/books/activities?limit=` 读取，`components/ReadingTimeline.tsx` 从"由 `startDate`/`completionDate` 派生"改为直接渲染流水。**为什么要独立成表**：新增与删除这两类事件根本无法从 `books` 派生——书删了行就没了，新增只有 `created_at` 分不清是导入还是 AI 推荐加入。表里冗余存 `book_title`，因为书被删除后仍要显示"删除了《XXX》"，靠 `book_id` 反查会拿到 null（书名改动后历史动态显示旧名，这反而符合"动态记录当时发生的事"）。四类事件的写入点：整库保存时服务端 diff（新增/删除/开始/读完，前端做不了——它拿不到"服务端当前是什么"，那份快照可能已被 AI 工具改过）、`DELETE /api/books/:id`、Agent 的 `update_book_status`（改前状态需在改写引用前捕获，否则 diff 恒为 false）。存量用户首次 `GET /api/books` 时按类型补齐历史事件（幂等：哪类缺失补哪类，而非"表里有任何一条就跳过"，否则第一版只补 `added` 之后再想补 `started` 就永远进不来），阅读事件的时间取书里真实的 `startDate`/`completionDate`，不用 `now()`——否则一本 7 月读完的书会显示成"今天读完"
- **书库排序新增「最近加入」并设为默认**：`createdAt DESC`，新导入的书直接排最前，不必滑到 417 本的底部。同时修好「最近活动」的空值兜底——它原先取 `completionDate || startDate`，417 本里 413 本未读书两者皆空，`''.localeCompare('')` 恒为 0，排序等于没做，退化成数据库默认的 `created_at ASC`（新书恒在最后，这正是"新书沉底"的根因）。现在空值时回退到 `createdAt`，未读为主的库也至少是"新书在前"
- **书籍详情页删除入口**：`BookDetail` 头部新增删除按钮（灰→红 hover，与关闭按钮的灰→黑区分开，避免误点），走 `ConfirmDialog` 二次确认并明确告知"阅读进度、AI 解读和评分会一起删除，且无法恢复"。此前 `bookService.deleteBook()` 早已定义但**全仓无调用入口**，删除只能靠整库保存时"书不在列表里"被动触发
- 阅读画像真正接入推荐链路：设置页新增「阅读画像」表单（阅读水平 / 目标 / 每日时长 / 偏好分类），`App.tsx` 挂载时拉取 `GET /api/profile`。此前画像接口与后端 `【用户画像】` 注入逻辑都在，但前端从未请求，AI 侧画像段与 `get_user_profile` 工具恒为空。（透传给 AI 组件这一段已被后续改动取代：画像改由后端在流式端点内直读 SQLite，见「变更」首条；`App.tsx` 的拉取仍保留，供设置页表单使用）
- `GET /api/profile/stats` + `backend/src/services/libraryStats.ts`：统计口径收敛为单一实现，`buildLibraryOverview`（发给模型的概览）、`get_category_stats` 工具与统计页共用
- `docs/AI-RECOMMENDATION-ROADMAP.md`：AI 荐书链路诊断与路线图（画像链路断点、常驻注入分档、统计口径归一、移动端缺陷、采纳反馈闭环与评估集），逐条附 `文件:行号` 证据与验收标准
- **`update_user_profile` 写工具**（Agent 工具从 9 个增至 10 个）：对话中问出来的阅读水平 / 目标 / 每日时长 / 偏好分类能落回 `user_profiles` 表，写后立即刷新 `ctx.userProfile` 并清空工具缓存，让同一次请求的后续工具读到新值。此前 Agent 只能"这一场记住"，会话结束就蒸发、下次冷启动重新问一遍——那是"AI 主动询问用户"这条产品路径唯一的硬断点。字段按 patch 语义只更新用户明确说过的，`preferredCategories` 是覆盖式更新（提示词与工具描述里都写明了）
- **推荐采纳反馈入口**：新表 `recommendation_feedback` + `POST/GET /api/ai/recommend-feedback`，AI 顾问的每条推荐（书库匹配与新书建议都算）挂「想读 / 跳过」按钮，点击即记录，失败会回滚按钮状态。`requestId` 由前端在发起请求时生成、贴在本次结果对象上，点按钮时随反馈请求一起 POST，用于把同一次请求的展示与点击归组（服务端不生成它，也不持久化 query 本身）。口径要留意：**只记显式点击、不记"展示了哪些"**，所以现在能算"点了什么"的分布，还算不出严格采纳率（缺分母）
- **书库硬闸门**：模型这一轮一次书目查询都没做、却给出非空 `libraryMatches` 时，后端追加 1 轮重问，提示词直指"这些 bookId 无从核对，先查书库；查完确实没有就把 `libraryMatches` 留空、改用 `externalMatches` 并如实说明"。此前"推荐前必须先查书库"只写在 370 行系统提示的中间，属劝导，弱模型会跳过判定、凭记忆报书名和 ID。闸门只在书库 >100 本时启用（≤100 本概览里本来就是全量 `[id] 书名`，不查工具也算有据可依），判据限定为"声称推了书架上的书"，寒暄回复不会被拖去多花一轮

- **AI 荐书评估台**（`backend/eval-advisor.js` + `backend/eval-queries.json`）：补上路线图 §4.2 一直空着的评估集——9 条单轮 query（明确目标 / 模糊心情 / 难度挑战 / 分类检索 / 跨类 / 续读 / 站外新书 / 寒暄 / 笼统）+ 1 组两轮记忆探针。按三点隔离跑真实模型（`VACUUM INTO` 快照库换 cwd、env 覆盖模型名、现签 JWT），逐条记录 mode / 命中数 / 工具序列 / 轮数 / 耗时 / `matchValidation` / 假信号词频，落 `backend/.eval-run/<tag>/results.json`，`--compare=a,b` 出对比。**不传 `--run` 只打印用法**（真实计费）；`.eval-run/` 含用户书库快照，已 gitignore

- **画像字段的来源与覆盖保护**：新表 `profile_field_meta` 逐字段记录"这条信息是谁写的"——`source: 'user'`（设置页填写 `via: 'form'`，或用户在对话里明确说过 `via: 'conversation'`）与 `source: 'ai'`（AI 记录/推断，必带 `evidence` 用户原话）。**用户自己定的属于用户的期望，AI 的推测不得覆盖**：命中时写入函数拒绝该字段、把 `refused` 原样回给模型，让它如实说明"这条是你自己定的，我改不了"。设置页新增「这些信息从哪来」逐字段展示，并写明"你自己填或亲口说过的，AI 只能沿用、不能改写"
- **画像落盘闸门 + 尾部指令**：`hasStableProfileStatement()` 从用户消息里识别"我的水平/我的目标是/我每天能读 40 分钟/我偏好…"这类自述，命中才开 `requireProfileWrite`；模型一轮下来一次 `update_user_profile` 都没调就追加 1 轮纠正。落盘指令同时压到用户提示词尾部（原先只在 370 行系统提示的第 35 行）。判据是"尝试"而非"成功"：写入被拒也是合法结果
- **两个零 token 的离线用例**：`backend/check-profile-provenance.js`（15 项：来源标记、拒绝覆盖、同值跳过、ai→user 来源升级、数组同值比较等）、`backend/check-validation.js`（6 项：推荐输出清洗与站外去重）
- **上下文体检 `backend/inspect-context.js`**：打印"这次请求到底往模型里塞了什么"——书库注入档位与理由、三道闸门的启用状态、system / user / tools schema 各自字符数与占比、user prompt 逐段字符数、画像四档实况、工具分类清单。它**直接调用线上同款 `buildAdvisorPrompt()`**（本轮从 `getRecommendationsStream` 里抽出来的），所以数字不会与真实请求漂移。首次实测：一次推荐请求 18,405 字符 ≈ 11.5k token，其中静态部分（system 61% + tools 27%）占 88%
- **长期记忆 `user_memories` + 两个新工具**（Agent 工具 10 → 12，配 Exa 共 14 个）：记忆存**塞不进画像槽位**的稳定信息——事实、偏好、禁忌、约定（"我在准备考试""我不看成功学"）。`remember` 写、`recall_memory` 查；两者都必须带 `evidence`（用户原话）。写入有三道门：空内容拒收、同内容（归一化后）去重、**被用户删过的内容永不复活**（`status='rejected'` 是墓碑，同时挡住同内容再次写入）。活跃上限 200 条，到顶拒绝新增并让模型去合并
- **检索式记忆注入（不是全量）**：`selectRelevantMemories` 用二元字组重叠打分（中文没有空格），`constraint` 有意加权——踩到用户明说过的禁忌代价高于漏掉一条偏好，所以它与当前问题字面无关时也会被带上，但**限流 2 条**以留槽位给真正相关的内容。硬上限 **≤3 条、内容合计 <500 字符**（实测 155 字符）。理由是量级：画像 4 个字段 160 字符可以无脑全发，记忆会长到几百条，全量注入会稀释指令（"370 行提示词里第 35 行那句话被稀释到 0 次触发"是这个仓库付过学费的教训）
- **回合后抽取扩展为"画像 + 记忆"**：抽取器现在输出 `updates` 与 `memories` 两部分，`POST /api/ai/profile/extract` 相应更名为 **`POST /api/ai/extract`**。异步抽出的一切**一律记为 AI 来源**（画像字段 `source='ai'`、记忆 `source='ai'`）——它们没被用户要求过，因此画像覆盖不了用户自己定的字段、记忆也会在界面上标成"AI 记录的"并附依据
- **记忆管理接口与界面**：`GET /api/ai/memories`、`POST /api/ai/memories/reject`（墓碑）、`POST /api/ai/memories/restore`；设置页新增「AI 的记忆」卡片，按类别分色展示内容、来源、依据原话与到期时间，可逐条删除，并可切到"显示已删除的"再恢复
- **「AI 记住了…（撤销）」提示条抽成共享组件** `components/RememberedNoteBanner.tsx`：画像字段与长期记忆在同一个提示条里展示（对用户来说它们是同一件事："AI 刚偷偷记住了什么"），一键撤销同时处理两者（字段走日志还原、记忆走墓碑）
- **离线用例 `backend/check-memories.js`（28 项）**：逐条对应路线图 §16.5 的验收标准——去重、删除是终态（含"同内容被自动记回时拒绝"）、TTL 过期不注入、注入上限、与画像互不污染、`event` 类默认 60 天寿命、活跃上限、`last_used_at` 更新
- **评估集新增两条记忆场景**：`memory-remember`（"记住：我不看成功学…"）与 `memory-apply`（下一轮问商业书，看禁忌是否被遵守）
- **Agent 全貌图 `docs/agent-map.html`**：把"一次请求的 9 步流程、提示词组成、12 个工具、两道写操作闭环、数据落点、能力边界、哪些端点没接线"画成一张自包含的页面（无外部依赖），用于回答"看不清 agent 在跑什么"
- **回合后的画像抽取（不依赖模型自觉的那条路）**：顾问回答完，前端再单独调 `POST /api/ai/extract`（本轮由 `/profile/extract` 更名而来，因为它同时抽画像与长期记忆），只问"用户这句话里有没有稳定信息"。两道零成本闸门先挡——顾问本轮已自己落盘（`done` 回传 `profileWritten`）→ 跳过；用户消息未命中自述正则 → 跳过（实测"你好呀" 0.0s、零 LLM 调用）。命中才花一次廉价调用（无工具、无书库概览，实测 7.3–7.7s）。**异步路径一律记为 `source: 'ai'`**：它没被用户要求过，所以永远覆盖不了用户自己填/亲口说过的字段。阅读管家（统计页悬浮助手）也已接入同一条路与同一个提示条组件
- **画像改动日志与撤销**：追加式 `profile_write_log`（`prev_value`/`next_value`/`source`/`via`/`evidence`/`prev_source`/`origin`/`undone_at`），撤销即精确还原。两个边界都处理了：`reading_level` 是 NOT NULL 列，撤销回到默认值并删掉来源行（重新处于"默认值、用户未确认"这一档）；写入前没有来源行时撤销要**删除**来源行而不是写空值。接口：`GET /api/ai/profile/log`、`POST /api/ai/profile/undo`
- **可见可撤销的两层界面**：对话里当场弹「AI 记住了…（撤销）」提示条（`AIAdvisor`）；设置页有完整的「画像改动历史」——值的前后对比、来源、依据原话、时间、逐条撤销、已撤销标记
- **画像字段校验抽成一份** `normalizeProfilePatch()`：现在有两条写画像的路径（对话中的工具、回合后抽取），各写一份校验必然漂移（一条接受"中级"、另一条拒绝）
- **`eval-advisor.js` 新增 `--extract` / `--undo` 探针**：在隔离环境里验证"抽取 → 撤销"整条 HTTP 路径（一次廉价调用，实测写入 2 字段、逐字段带原话依据、撤销后值清空、重复撤销 400）

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
- 后端认证、书库、豆瓣路由与提示词同步调整- 文档体系重建：README / ARCHITECTURE / CHANGELOG 按当前代码重写，历史版本移入 `docs/archive/`，参考资料移入 `docs/`
- 文档校正（对照源码逐条核实，未改任何代码）：鉴权范围改为"books/profile/ai/douban 均需 requireAuth，仅 register/login/health 免鉴权"；说明 Zod 校验仅 `ai.ts` 有 `validate` 中间件、`douban.ts` 多数端点未校验；`DOUBAN_PROXY_URL` 代码默认值为空（示例值仅在 `.env.example`）；区分豆瓣搜索（始终走网络）与详情（缓存 + 必需 Python，无 Node 兜底）两条链路；SSE 解析归属 `services/geminiService.ts` 而非 `useAIStreaming`；前端构建实测耗时与 chunk 体积
- `update_user_profile` 工具新增两个参数：`evidence`（**必填**，直接引用用户原话片段，会随字段一起展示给用户）与 `userStated`（只有用户本轮亲口说出的值才传 true；传 true 才允许改用户在设置页填过的字段）。工具返回值新增 `written` / `refused` / `refusedHint`
- `buildProfileBlock` 改为四档渲染画像：**用户自己定的**（不要覆盖、不要否定）／**AI 记录推断的**（是推测，可修正）／**数据库默认值**（有值却无来源记录，如注册时写的 `beginner`，明确标注"用户从未确认过"）／**尚未设置**（可以问）。`get_user_profile` 工具同样按 `userStated` / `aiRecorded` / `unset` 分组返回
- `PUT /api/profile` 的回包多一个 `written` 字段（实际写入的字段名列表），`data` 仍是完整画像

### 修复
- 移动端 `fixed` 底部导航遮挡内容：AI 顾问的吸底输入区（`sticky bottom-0` 正好压在导航下面，心境条与输入框点不到）、统计页右下角悬浮管家按钮、统计页与设置页尾部留白不足。统一由 `styles.css` 的 `--bottom-nav-h`（导航实高 4.5rem + 手势条安全区，`viewport-fit=cover` 已开）驱动避让，桌面端 `md:` 覆盖后不受影响
- 顶部 `fixed` 导航压住页面标题：AI 顾问对话态只有 `pt-4`（16px），而导航实高 88px，图标块与标题被压在下面；其余页面各自硬写 `pt-20`（80px）也差 8px，且 `viewport-fit=cover` 下刘海区域完全不避让。新增 `--top-nav-h`（5.5rem + `safe-area-inset-top`），书库/统计/设置/导入向导/AI 顾问五个入口统一改用它，导航本身改为 `top-[env(safe-area-inset-top)]`
- AI 顾问空状态"标题贴顶 + 输入区贴底 + 中间一大片空白"：空状态改为整屏垂直居中，并补上快捷提问与真实在读进度两块内容；对话态移除页面标题与活动面板里重复的"AI 阅读顾问"标签（每条回复自带机器人头像）
- 刷新时整页闪黑框的**原根因判定已被推翻**（原记录：`Ctrl+R` 属键盘操作 → `body` 命中 `:focus-visible` → UA 默认描边沿视口四边画出）。所保留的加固本身仍然有效且照旧生效：`styles.css` 的 `:focus-visible` 拆成"`outline:none` 兜底 + 光环只给控件"、显式排除 `html/body/#root`，`index.html` head 内联补 `html:focus-visible, body:focus-visible { outline: none }` 首帧即生效。但它治的不是现在这个现象，见下一条
- 【已定位、未修复】刷新时内容区顶部闪一条 **24px 高的纯黑横带**。像素定位（用户提供的全窗口截图，2239×1399，无色彩偏移）：y=131–154 全宽 `(0,0,0)`，y≥155 起才是页面自身的 `#fafafa`（`index.html:9` 内联），y≤128 是 Chrome 工具栏白、y=129 是 1px 分隔线；**左右两侧无任何暗列**（故不是"四边一圈"）。页面侧因素逐项排除：登录态（DOM 节点 42→2082）逐帧扫描 385 帧，覆盖 ≥60% 视口的元素中深色 outline/border/box-shadow/bg **0 命中**；head 内联样式最早可绘帧（t=3ms、sheets=1）即已生效；`body` 的 computed `outline-style` 全程为 `none`；鼠标点刷新、无痕窗口、关闭图形加速、生产构建 `npm run preview`、`about:blank`/其他站点五种条件**全部仍闪**。再在受控浏览器里做高帧率复现，**两次都没复现**：Playwright Chromium（全新临时 profile、无扩展）20fps × 3 次 reload × 239 帧 0 命中；本机正式版 Google Chrome（`--start-maximized`、全新 profile、dpr 1.5、内容区上沿偏移实测 134 device px）在 400×80 取样块上 **59fps × 3 次 reload × 754 帧 0 命中**（判据：单行 ≥90% 像素亮度 <40）。结论收窄：与 DeepRead 代码无关，也不是本机 GPU/通病的必然表现，而是**用户那个 Chrome 配置档的状态**——无痕窗口已排除普通扩展，但 **Chrome 主题与 `chrome://flags`（尤其 Auto Dark Mode）在无痕下照旧生效**，正好落在"无痕仍闪 / 干净 profile 不闪"这条分界线上。用户侧下一步按代价排序：① 访客窗口（干净 profile、无主题无扩展）里刷新是否还闪，5 秒定论；② `chrome://settings/appearance` 主题改回默认；③ `chrome://flags/#enable-dark-mode` 恢复 Default；④ 要像素证据就跑 `powershell -File strip-capture.ps1 -OutDir userflash -Ms 8000 -Delay 1500 -Y 60 -H 300 -W 500`，期间连按两次 `Ctrl+R`。原先记的两条缓解实验（加 `<meta name="theme-color">`、去掉 `viewport-fit=cover`）**不再必要**：它们改的是页面，而页面侧已被排除
- 加载屏的转圈动画不可见：`App.tsx` 两处加载屏与 `components/Spinner.tsx` 的 `lg` 档用了 `border-3`，而 Tailwind 的 borderWidth 档位只有 0/1/2/4/8，该类不生成任何规则，于是 `border-zinc-200 border-t-zinc-900` 全挂在 0 宽边框上，只剩文字。改为 `border-[3px]`（与 `Spinner` 的 `md` 档 `border-[2.5px]` 同一写法）
- 追问"上次推的那几本是什么"要多花一轮：`AIAdvisor` 拼对话历史时把书库推荐写成 `《${m.bookId}》`，书名 `m.title` 就在手边却没进字符串，喂给下一轮的"上次推荐了什么"是一串 UUID。实测同一句追问：只给 UUID 时模型要多调一次 `get_book_details` 反查（2 轮 / 10.6s），给书名则 1 轮 / 6.5s 直接答。改为 `《书名》[id:UUID]` —— 书名给回模型、ID 保留接地能力（历史里的 ID 已过服务端校验，可放心复用）。注意这不只是省时间：`MAX_ROUNDS=3` 用尽的那一轮里（413 本库上"从书架挑三本"实测恰好 round 3/3），反查那一轮根本不存在，模型只能猜
- **多条调用时前端整体卡住**（症状：界面长时间转圈，但数据并没丢）：归因实测落在浏览器侧，不是后端也不是 React 渲染。四个流式组件（`AIAdvisor` / `BookDetail` / `BookQA` / `ReadingAssistant`）的 `.abort()` 原先只挂在手动「停止」按钮上，而切页时组件被 `App.tsx` 的 `key={activeTab}` 硬重挂载，在飞的 SSE 无人中止、一直占着连接；Chrome 对单域名只有 6 条 HTTP/1.1 连接，攒够之后**所有**接口请求（包括切页要发的 `GET /books`）都排在连接队列里。对照数据：同一后端、同样 12 个各持 6s 的请求，Node 发出去服务端峰值并发 12、墙钟 6.0s，Chrome 发出去服务端只看到 6、墙钟 32.0s（5.3×）；真实应用上 8 条请求在飞时一次 `GET /api/profile/stats` 从 15ms 变 **7569ms**。现各加一条 unmount 清理，修后复测：切页瞬间后端即记到「客户端断开」（此前只在浏览器关闭时才出现），切走紧接着的 stats 请求 12ms。顺带排除两条常见猜测——React 主线程不是瓶颈（真实流式请求跑满 36s，长任务 0 个、rAF 断帧 0、`setTimeout` 延迟 max 17ms）；换 host 写法绕不开池子（`localhost` 与 `127.0.0.1` 混发仍峰值 6）
- 全量保存可重叠：`App.tsx` 的 500ms 防抖 `POST /books/batch` 既不 await 也不取消，而流式进行中每条 `book_update` 都会 `setBooks` 一次，于是多条整库请求（实测 413 本 ≈667KB、后端同步 ≈88ms）并发发出、后回来的覆盖先回来的结果。改为同一时刻只允许一条在飞，保存期间的新改动记为脏、收尾后自动补存一轮，且脏标记未清时不用旧响应回灌本机状态
- AI 顾问对"你好"这类寒暄直接输出整份书单：`readingAdvisor` 系统提示 370+ 行里模式判定写在中间，而 `getRecommendationsStream` 传给 `withTools` 的 extraHint 尾句又写着"直接给出推荐"，弱模型按尾部惯性跳过判定。现把模式闸门移到用户提示词最后一条（流式与非流式两条路径同步），并把该尾句改为"直接回答即可，寒暄或笼统请求按对话模式简短回应、不要输出书单"
- 后端经本地代理出网时 AI 全量 `fetch failed`：Node 的全局 `fetch` 默认不读 `HTTP_PROXY` / `HTTPS_PROXY`，而此类机器上 DNS 会把 LLM 域名解析成 `127.x` 占位地址，直连必 `ECONNREFUSED`（`curl` 读代理所以是通的，易误判为"网络正常"）。`start.bat` 现内置 `NODE_USE_ENV_PROXY=1`，README 补自查方法

### 修复（2026-10-18：豆瓣导入失败 + 首页长列表卡顿）

- **重启后端后首次批量导入，只有第一本成功、其余全 404**（`[Douban] 抓取书籍 xxx 失败: Error: Python 未安装`，而 `python --version` 明明正常）。根因是 `doubanService` 的 `checkPython()` 布尔旗标竞态：先置 `pythonChecked = true`、再去 `execFile` 异步探测，而 `IngestionWizard` 用 `Promise.all` 一批并发 10 个 `/douban/find`，后来者读到尚未赋值的 `pythonAvailable === false`，把"正在检测"误判成"未安装"。现改为缓存 **in-flight Promise**（`pythonProbe`），并发请求共享同一次探测，且探测结果直接带命令名，不再为拿命令名重复 execFile。实测冷启动 10 并发：修前 1/10 成功，修后 **10/10**（4632ms）
- **`scrapeBook` 可能永久挂起 / 静默失败**：原先 `spawn` 没有超时（Python 侧卡住时前端一直转圈，并发导入还会堆 10 个僵尸进程）、没有 `error` 事件监听（命令不存在时 Promise 永不 settle）、`JSON.parse` 直接吃整个 stdout（stderr 有告警就抛，被 catch 吞成"抓取失败"）。现补 `SCRAPE_TIMEOUT_MS = 60s` + `SIGKILL`、`python.on('error')`、只取最后一个 JSON 行解析、退出码非 0 但 stdout 有合法 JSON 时仍以 stdout 为准
- **详情抓取失败时整本书 404 → 前端静默退化成"只有书名"**：`findBookByTitle` 原先 `if (!cached) return null`，路由抛 `BOOK_NOT_FOUND`，`IngestionWizard` 只 `console.error` 就降级成无作者/无封面的裸记录，用户看到的是"添加失败"。现用 suggest 搜索结果兜底（书名 / 作者 / 年份 / 封面都在），只丢简介/评分/短评；兜底数据**不写进 memoryCache**，下次仍会尝试抓真实详情。实测摘掉 PATH 里的 python 后：3/3 拿到作者与封面（`summaryLen=0` 证明走的是兜底）
- **统计页点开即白屏**（`ErrorBoundary` 显示"出了点小问题"）：`StatsView.tsx:254` 把 `stats` 对象里的 `myRatingCount` / `myRatingAvg` 写成了裸变量，`ReferenceError` 直接打崩整个页面。触发条件是 `stats.ratedCount > 0`，即**只要书库里有带豆瓣评分的书就必现**。改为 `stats.myRatingCount` / `stats.myRatingAvg`（`6b84580` 引入）
- **书库页 400+ 本书时滚动"卡死"**：实测拆成三条独立原因。① **入场动画延迟链**：`LibraryView` 的 `delay: index * 0.05` 是给十来本书设计的，417 本时第 417 张卡片被排到 **20800ms** 后才淡入，滚到那儿还是个 `opacity:0` 空位 → 改为 `Math.min(index, 20) * 0.05`（最大 0.95s）。② **切 tab 重放全部动画**：`App.tsx` 的 `key={activeTab}` 会让组件硬重挂载（那是 SSE 中止契约的前提，不能删），于是每次切回书库都把 400+ 张卡片的淡入重播一遍（实测 1208ms）→ 用模块级 `libraryEntrancePlayed` 标记，重挂载照旧但动画只播一次，实测切回后 `maxDelayMs=0` / `invisibleCards=0`。③ **封面全走外部代理且并发无节制**：408 张封面指向 `douban-proxy.203065.xyz`，一上来就发几百个跨域请求（滚到底仍有 373 张 pending）→ 统一收敛到后端同源 `/api/douban/cover`，并给首屏 20 张 `loading="eager" + fetchPriority="high" + decoding="async"`，其余 lazy。另加 `content-visibility:auto` + `contain-intrinsic-size` 让屏外卡片跳过布局与绘制
- **封面全裂（接口 200 但 `<img>` 不渲染）**：三个叠加原因，缺一条都修不好。① `/api/douban/cover` 原本挂在 `router.use(requireAuth)` **之后**，而 `<img src>` 不会带 `Authorization` 头 → 一律 401；② 后端裸 `fetch` 豆瓣图床返回 **418 `cdn error 001`**（必须带 UA + `Referer: https://book.douban.com/`）；③ helmet 默认 `Cross-Origin-Resource-Policy: same-origin` 让浏览器拒绝跨端口（:3001 → :5173）的图片嵌入 —— 这条最隐蔽，`fetch` 拿到 200 和真实 JPEG，只有 `<img>` 失败。现：`/cover` 提到 `requireAuth` 之前并注明理由（目标域名已被 `isAllowedImageUrl` 白名单锁死，不含用户数据）、补 UA/Referer、helmet 只放开 `crossOriginResourcePolicy`、限流用 `skip` 豁免封面路径（400+ 张图放进 100/分钟必然 429）。实测 `CORP=cross-origin`、无 token 返回 27949 字节真实 JPEG、首屏 12/12 封面加载成功
- **`getBookCoverUrl()` 统一收敛到后端代理**：无论数据里存的是外部代理地址（`douban-proxy.xxx/?url=<豆瓣原图>`）还是豆瓣原始地址，都抽出内层 URL 再走本地 `/api/douban/cover`。此前那个外部服务挂掉就整库封面全裂
- **抓取失败的书以前只能删了重加，现在可以就地补全**：导入时豆瓣抓取失败（Python 缺失/超时/限流）的书在库里只有书名，封面/出版社/评分/简介全空，而详情页的豆瓣 Tab 只显示"暂无豆瓣数据"、没有任何补抓入口——删掉重加会连阅读进度、AI 解读、自评星级一起丢掉。新增 `POST /api/books/:id/refresh-douban` + 详情页「补全豆瓣信息」按钮（未读态也显示，因为抓取失败的书通常正是未读的），按钮在数据完整后自动隐藏。合并策略是**只填补空白**：`doubanData` 用 `doubanDataScore` 打分比较，新数据更完整才替换（避免用 suggest 级别的残缺数据冲掉完整详情）；`author`/`publisher`/`doubanId`/`coverUrl`/`isbn` 仅在原值为空时填；`title`/`category`/`level`/`userData`/`aiInsight` 一律不动。实测补抓 `巴菲特致股东的信：投资者和公司高管教程（原书第4版）`：从全空补成 id=30164963 / 评分 8.9 / 机械工业出版社 / 简介 536 字 / 472 页，6/6 项"用户数据未被改动"断言全绿
- **带副标题的长书名在豆瓣搜不到**：实测 `巴菲特致股东的信：投资者和公司高管教程（原书第4版）` 在 suggest 接口返回 0 条，砍成 `巴菲特致股东的信` 立刻命中。新增 `titleQueryVariants()` 逐级放宽（原名 → 去括号内容 → 截到第一个 `:：-—` 之前 → 超 20 字再截一刀），找到即止。实测库里 8 本缺 `douban_id` 的书补全 5 本；剩余 3 本（`易中天系列合集`、`智慧三书`、`Linux就该这样学`）是豆瓣上确实没有对应条目或书名本身不准（豆瓣是《Linux就该这么学》），属数据源问题而非代码问题
- **搜索能搜到书、详情永远抓不到（静默退化成 suggest 兜底）**：`searchDouban` 一直有"代理失败→直连"降级（所以搜索看起来一切正常），但 `scrapeBook` 没有这层降级 —— 于是 `DOUBAN_PROXY_URL` 代理一挂就出现最坏组合：搜索靠直连成功、详情靠代理必失败，最后静默退化成只有书名/作者/封面的兜底数据，日志里只有一句"详情抓取失败"，完全看不出是代理的问题。实测 2026-10-18：该代理 SSL 握手失败（`curl -x` 返回 **000**）、直连豆瓣返回 **200**，冷启动 10 并发 10/10 走兜底、`scrapeBook` **10/10 返回 null**，而接口层全是 200 看起来"成功"。现把原 `scrapeBook` 拆成 `scrapeBook`（负责降级）+ `scrapeBookOnce`（单次抓取，接收 proxy 参数）：先按配置代理抓，拿不到再直连一次。修后同场景：兜底 **0 次**、降级日志 **10 次**、详情全部完整（评分/简介/出版社/页数齐全）
- **126 张封面 403（"书库三分之一封面裂了"）**：`isAllowedImageUrl` 的白名单把豆瓣图床写死成 `img1/img2/img3` 三个分片，而豆瓣实际按 subject id 取模分到 **img1 ~ img9** 九个主机。库里 412 本带封面的书里 `img9.doubanio.com` 独占 **126 本**，与实测失败的 126 张完全对上（`loaded=289 failed=126`）。现改为正则 `^img[1-9]\.douban(io)?\.com$`，同时保持 SSRF 防护强度（`img10.doubanio.com`、`img9.doubanio.com.evil.com`、`evil.com`、`127.0.0.1` 实测仍全部 403）。修后分段滚到底：**loaded=415 failed=0 pending=0**

### 修复（AI 荐书信号修正，2026-09-25）

> 起因：用 `step-3.7-flash` 在隔离库（413 本真实书库快照）跑了一轮基线评估。模型的问题不是"不会推荐"，而是**"关于这个人的输入几乎全是错的"**——它照着默认值、豆瓣分和空阅读日志，推导出一套并不存在的人格。逐条证据见 `docs/AI-RECOMMENDATION-ROADMAP.md` §14。

- **画像默认值不再冒充用户陈述**：`user_profiles.reading_level` 在注册时就写成 `'beginner'`，而注入逻辑是"有行就注入"，于是模型把默认值当成用户自评——基线输出原文"你是 beginner 水平""作为 beginner 水平，建议先从最贴近生活的子领域切入"，并把主书压到 Basic。新增 `libraryTools.isProfileConfigured()` 作唯一判据（没填过任何"只有用户会填"的字段就注入"未设置，可以问"，不给水平），`get_user_profile` 工具同步返回 `configured: false`
- **评分拆成两套量纲**：`books.rating` 的语义是用户自评 1–5 星，但导入期写进去的是豆瓣 10 分制（实测 395 条里 **393 条 >5**、均值 8.43）。品味画像把它当评价倾向 → 判据 `avg >= 4.2` 恒真，模型据此输出"这个用户评价偏高、比较宽容"（基线里进一步变成"书库平均分 8.5 说明选书眼光不错"）。现在：用户自评存 `books.user_data.userRating`（JSON，**不需要加列也没有迁移**），取值统一走 `libraryStats.resolveUserRating` / `resolveDoubanRating`（`>5` 一律归豆瓣，兼容历史脏数据）；导入流程不再往 `rating` 写豆瓣分；详情页 / 书卡 / 统计页分开显示"豆瓣 X.X"与"我的评分 N★"
- **没有阅读行为就不推断阅读人格**：真实书库 413 本、**0 本读完**、4 本"在读"进度全为 0，旧逻辑据此输出"探索型读者（广泛涉猎，不追求读完）""停留在舒适区""用收集代替阅读"，`get_reading_gaps` 还给出"**不建议继续推荐新书**"——一个荐书功能对着刚导入的书目把自己劝停了。现在无行为数据时明确写"尚无阅读行为记录，不要据此推断"，积压检测改判为 `catalog_not_started`（`severity: info`）；有行为数据时才走原规则
- **去掉分析型工具的调用诱导 + 轮数预算 3→4**：`_shared.ts` 那句"建议优先使用 `get_reading_taste_profile` 和 `get_reading_gaps`"诱导的正是**已经压缩进概览**的两个工具（基线 17 次工具调用里有 4 次是它们）。**但要如实说明：改后这两类工具仍被调用 3+2 次，说明调用动机主要来自工具描述本身而非那句诱导——本轮并没有因此省下轮次**，改动只是拆掉了"主动教模型优先调它们"这一层。同时 `MAX_ROUNDS` 3→4：101 本以上概览不注入书名，基线 7 条推荐 query 有 3 条跑满 3 轮，查询轮与收敛轮重合，再触发书库硬闸门就完全没有余量
- **关键词检索覆盖分类**：`search_library` 的 `keyword` 原先只匹配书名 / 作者 / 标签，而 79 本心理学书里只有 **17** 本的书名或作者含"心理学"字样，模型传 `keyword="心理学"` 会得到"书里没有心理学书"的错误结论。现覆盖 category / subcategory / 豆瓣标签 / 豆瓣摘要 / AI 解读摘要
- **采纳反馈有了读取端与分母**：`recommendation_feedback` 此前只有写入方。现在服务端在每次 `/recommend/stream` 写入 `action='shown'` 展示记录，`requestId` 改由服务端生成并随 `done` 回传（客户端优先用它，展示与点击才能归组），`GET /recommend-feedback` 返回 `stats.wantRate`；`createAgentContext` 把最近想读 / 跳过读成 `ctx.feedbackSummary` 注入【采纳反馈】段——反馈因此真的影响下一次推荐
- **对话历史落 SQLite**：`conversations` 表（还带两个索引）建好后**全仓没有任何写入方**，历史只在 localStorage 且只留 10 轮，换设备或清缓存即归零。新增 `GET/PUT/DELETE /api/ai/conversation` 与 `saveConversation` / `loadConversation` / `clearConversation`；`AIAdvisor` 挂载时以服务端为准、localStorage 降级为即时镜像，保留轮数 10→20，注入窗口 `MAX_CONVERSATION_MESSAGES` 20→40
- **接通 `ai_analysis`**：生成端 `/api/ai/profile/stream` 与设置页展示位都在，但前端零调用、后端不写回，真实数据里 `ai_analysis` 恒为 NULL，注入画像永远少"盲区 / 建议方向"这两行（最能改变推荐口吻的两行）。现在该端点把结果归一化后写回 `user_profiles.ai_analysis`，设置页新增「AI 分析我的阅读结构」按钮；`buildProfileBlock` 还会在画像超过 90 天时标注"可能已过时"
- **站外推荐与书库去重（评估跑出来的一条新缺陷）**：提示词红线第 4 条禁止把书库里已有的书当站外推荐，但 `externalMatches` 此前**完全不做校验**——基线同一次评估里《悉达多》既出现在"书库匹配"又出现在"站外推荐"。现在 `validateAdvisorJson` 用同一套书名归一化查重，命中即剔除并把书名放进 `matchValidation.externalDuplicates`，界面提示"N 条站外推荐与你的书库重复，已过滤"
- **在读书籍进度 0% 的口径写进概览**：基线里模型反复把"4 本在读、进度全是 0%"解读成"同时啃 4 本导致启动困难""认知过载"。概览的【在读书籍】标题现在写明"进度 0% 只说明还没在界面上记录，不代表没在读"

#### 本轮实测（`step-3.7-flash`，413 本书库快照，9 条 query 前后各跑一轮 + 3 条复验）

| 假信号（模型输出里的"人格判决"） | 改前 | 改后 |
|---|---|---|
| 把用户说成 `beginner`（"你是 beginner 水平""作为 beginner 水平"） | 4 条 query | **0 条** |
| 探索型 / 不追求读完 / 用收集代替阅读 | 5 条 | **1 条** |
| 舒适区 / 积压 / 囤书 | 3 条 | 2 条 |
| 评价偏高 / 宽容 / "平均分 8.5 说明选书眼光不错" | 1 条 | **0 条** |
| 把进度 0% 当行为证据（"0% 说明…"） | 3 条 | 1 条 |
| **合计** | **16 条** | **4 条（-75%）** |

平均耗时 34.8s → 29.7s，平均轮数 2.00 → 1.89。难度适配有可见改善：`level-challenge`（"别给我入门书"）改前主书 CSAPP + 放松书《最好的告别》，改后 CSAPP + **DDIA（同为 Expert）**；`goal-explicit` 改前 3 本全 Basic，改后补入 Advanced 的《改变心理学的 40 项研究》。站外去重离线校验 6/6 通过（`backend/check-validation.js`，零 token）。

**本轮未改善 / 新暴露的问题**（不当作已解决）：- `mood-vague`——"最近工作压力有点大，想读点轻松的"改前改后都走 `conversation`、一本不给，而系统提示自己把"心境 + 方向"列为**推荐**信号。属模式闸门的误判，改提示词需要单独一轮评估，本轮未动。
- `external-books` 改后只调了 1 次工具、**没走 `web_search`**，站外推荐少了联网核实；单次采样不足以下结论，但值得下一轮盯住。
- 推荐理由的平均字数 116 → 104、含《》引用占比 75% → 62%，具体性略有下降（同样只有单次采样，需重复测量才能定性）。
- 耗时仍偏高（单条 30–80s），其中 `memory-profile` 首轮 94s。这是"3–4 轮工具 + 联网核实"的固有成本，本轮没有优化目标。

#### 画像落盘实测（同一探针，`step-3.7-flash`，2 轮）

| | 改前（baseline / after / after2 三轮合计 27 次请求） | 加尾部指令 + 闸门后 |
|---|---|---|
| `update_user_profile` 调用 | **0 次** | **2 次（两轮各在第 1 轮就写）** |
| `user_profiles.reading_goal` | NULL | `补上统计学和因果推断` |
| `user_profiles.daily_reading_time` | NULL | `40` |
| `profile_field_meta` | 表不存在 | 两字段 `source='user'`、`via='conversation'`、`evidence` = 用户原话 |
| `reading_level` | `beginner`（无来源） | 仍 `beginner`、**无 meta 行** → 注入时标注"数据库默认值，用户从未确认过" |

另外验证到两条设计细节在真实运行里生效：① 第二轮模型用**同值**重发了同样的字段，被"同值且来源不变就跳过"的规则挡住——两行 `updated_at` 仍是第一轮那次，依据没被覆盖；② 闸门本身**没有触发**（日志无「画像落盘闸门」），说明尾部指令这一次就够了，没有多烧那一轮。**残余**：尾部要求的"落盘后用一句话说明你记住了什么"在 `analysis` 字段里没看到显式体现，待观察。

#### 长期记忆实测（`step-3.7-flash`，隔离库，评估集新增的两条 query）

| 环节 | 结果 |
|---|---|
| 写入（`memory-remember`："记住：我不看成功学…"） | 模型**调用了 `remember`**（12.2s / 1 轮工具），回复"记住了！以后不会给你推成功学或鸡汤类书籍" |
| 落库内容 | `kind='constraint'`、`source='user'`、`origin='explicit'`、`evidence` = 用户原话，`expiresAt=null`（不该过期） |
| 下一次注入（计算式验证） | `buildMemoryBlock(uid, "推荐几本能提升商业思维的书")` 返回**155 字符**的【长期记忆】块，含该禁忌与依据；≤3 条、<500 字符的上限符合 |
| 是否遵守（`memory-apply`） | 推荐《芒格之道》的理由原文："**这本书不是成功学鸡汤**，而是用跨学科视角拆解商业决策"——约束被读取并显式执行 |

**残余（本轮未修完）**：同一轮里模型仍写下"这很像**囤积式阅读**：用收藏代替阅读，用广度代替深度"。上一轮的修法是"禁止出现这几个词"，而它换了个说法继续判——**枚举永远列不全**。本轮把口径从"别用这些词"改成"**不要从藏书推断任何阅读习惯**"并点名了"囤积式阅读/用收藏代替阅读/广度代替深度"等变体，但这一处**改动本身没有单独再跑评估验证**（改动只让禁止面更大，不会引入新行为）。

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
