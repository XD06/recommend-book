# 将 AI Agent 嵌入你的 App：一套可复用的三层架构

> **读完这篇，你能直接把一套完整的 Agent 流程搬进任何 App——不管你是做电商、CRM、知识库还是项目管理，核心模式不变。**
>
> 本文不卖概念，只讲工程。每个 Section 附带可跑的代码骨架，最后有一张选框架的决策表和一份上线检查清单。

---

## 前言：AI Agent 嵌入 App 不是魔法

市面上关于 AI Agent 的文章大多是「我们做了什么」的复盘，缺的是「你怎么做」的操作手册。本文补这个缺口。

先建立共识——任何 AI Agent 嵌入 App 的架构，本质只靠 **七个设计原则** 撑住：

| # | 原则 | 一句话 |
|---|------|--------|
| 1 | **概览 + 按需钻取** | 给 AI 一个目录，让它自己通过工具查详情，别把全量数据塞进 prompt |
| 2 | **两阶段分离** | 思考阶段静默收集（非流式、多轮工具调用），表达阶段流式输出给用户 |
| 3 | **工具即上下文过滤器** | 每个工具的返回值是「刚好够用」的最小数据集，而非整行 dump |
| 4 | **读写闭环** | AI 不只回答问题，还能通过写工具直接操作 App 状态 |
| 5 | **SSE 语义事件协议** | `phase` / `tool_call` / `chunk` / `done` / `error`——让前端「看见」AI 在干什么 |
| 6 | **优雅降级** | 有数据走 Agent，没数据退化为普通对话；Agent 是增强，不是必需 |
| 7 | **成本内建** | 轮次上限、LRU 缓存、字段裁剪——从一开始就是架构约束，不是打补丁 |

再加上一条架构原则：**插槽架构（Slot Architecture）**——Agent 循环不认任何具体工具，拿到 `tool_calls` → 执行 → 回传，加新工具不改一行循环代码。

> **这七条 + 插槽架构，已经有成熟开源实现。你不用自己造。**

除了这七条，本文还深入两个被大多数 Agent 文章跳过的硬问题：

- **上下文爆炸的成因和三级防御**（第 2.6 节）——不是「截断」这么简单
- **工具设计的五条铁律**（第 2.5 节）——工具写不好，Agent 等于残废
- **工具暴增后的分层管理**（第 6.1 节）——5 个工具和 20 个工具，LLM 的选工具精度天差地别

---

## 一、总览：三层架构

把上面这套东西塞进你的 App，落地成三层：

```
┌──────────────────────────────────────────────────────┐
│              Layer 3: 前端消费层                       │
│   EventSource 监听 → 事件分发器                        │
│   ├─ phase    → 切换 UI 状态（思考中 / 输出中）         │
│   ├─ tool_call → 渲染工具调用卡片（搜索中… 查询详情…）   │
│   ├─ chunk    → 打字机效果追加                         │
│   ├─ done     → 展示结构化结果                         │
│   └─ error    → 错误提示                               │
│                                                      │
│   关键能力：AI 不仅显示信息，还能通过写工具操作 App UI    │
└────────────────────┬─────────────────────────────────┘
                     │ SSE (Data Stream Protocol)
┌────────────────────▼─────────────────────────────────┐
│          Layer 2: 流式传输层（你 App 的后端 API）       │
│   POST /api/agent                                     │
│   → 根据用户输入，启动 Agent 循环                       │
│   → 通过 SSE 流式输出语义事件给前端                     │
│   → 一次请求 = 多轮 LLM 调用 + 工具执行 + 流式回复      │
└────────────────────┬─────────────────────────────────┘
                     │ 内部调用
┌────────────────────▼─────────────────────────────────┐
│           Layer 1: Agent 循环（核心引擎）               │
│   runAgent(userMessage, tools) {                      │
│     loop:                                            │
│       1. LLM 决定 → 回复 or 调工具                     │
│       2. 如果是 tool_calls → 逐个执行 → 结果回填       │
│       3. 如果是 text → 跳出循环，流式输出               │
│       4. 达到 maxSteps → 强制结束                      │
│   }                                                  │
│                                                      │
│   Agent 循环不认任何具体工具，只认统一接口               │
└──────────────────────────────────────────────────────┘
```

**每层职责一句话：**

- Layer 1：**「AI 应该做什么 + 能调什么」**——工具定义 + 循环调度
- Layer 2：**「怎么把过程告诉前端」**——SSE 流式传输 + 语义事件
- Layer 3：**「用户看到什么 + 能怎么交互」**——事件消费 + UI 渲染 + 状态同步

下面逐层拆开，带代码。

---

## 二、Layer 1：Agent 循环——工具注册 + 自主决策

这是整个系统的发动机。核心只有两个东西：

### 2.1 工具定义：一个文件一个工具

```typescript
// tools/search-products.ts
import { tool } from "ai";
import { z } from "zod";

export const searchProducts = tool({
  description: "按关键词搜索商品，返回匹配的商品列表概览（只含 id、名称、价格、主图）",
  parameters: z.object({
    keyword: z.string().describe("搜索关键词"),
    category: z.enum(["电子", "服装", "食品"]).optional(),
    maxResults: z.number().default(5).describe("最多返回条数"),
  }),
  execute: async ({ keyword, category, maxResults }) => {
    // 这里查你的数据库
    const results = await db.product.findMany({
      where: { name: { contains: keyword }, category },
      take: maxResults,
      select: { id: true, name: true, price: true, image: true },
    });
    return { total: results.length, items: results };
  },
});
```

**为什么选这些字段？** 把工具返回值控制在「刚好够用」——这是原则三「工具即上下文过滤器」。AI 拿了概览觉得哪条相关，再调 `getProductDetail` 去取完整信息。

### 2.2 工具注册表：运行时条件拼装

```typescript
// tools/registry.ts
import { searchProducts } from "./search-products";
import { getProductDetail } from "./get-product-detail";
import { searchOrders } from "./search-orders";
import { updateOrderStatus } from "./update-order-status";
import { searchWeb } from "./search-web";

export function getAllTools(config: AppConfig) {
  const tools: Record<string, any> = {
    searchProducts,
    getProductDetail,
    searchOrders,
  };

  // 条件拼装：配了 API Key 才暴露 Web 搜索
  if (config.EXA_API_KEY) {
    tools.searchWeb = searchWeb;
  }

  // 条件拼装：只有开启了「AI 可写」模式才暴露写工具
  if (config.ALLOW_AI_WRITE) {
    tools.updateOrderStatus = updateOrderStatus;
  }

  return tools;
}
```

**这就是插槽架构。** 今天想加个天气查询？写一个文件，往这个函数加一行，结束。Agent 循环代码不改，其他工具不动，前端不碰。

### 2.3 Agent 循环：不认工具的「主板」

下面的循环是整个系统唯一不需要改的地方——它不包含任何业务逻辑，只做一件事：**拿 AI 的 tool_calls → 执行 → 回传，重复到 AI 觉得够了或达到上限。**

```typescript
// agent/loop.ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import { getAllTools } from "../tools/registry";

export async function* runAgent(userMessage: string, appConfig: AppConfig) {
  const tools = getAllTools(appConfig);

  // 发 phase 事件：思考阶段开始
  yield { type: "phase", phase: "collecting" };

  const result = streamText({
    model: openai("gpt-4o"),
    system: buildSystemPrompt(appConfig), // 包含可用工具的简要说明
    messages: [{ role: "user", content: userMessage }],
    tools,
    maxSteps: 5, // 原则七：成本内建——轮次上限
  });

  // fullStream 包含所有中间事件：tool-call, tool-result, text-delta 等
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "tool-call":
        yield { type: "tool_call", toolName: part.toolName, args: part.args };
        break;
      case "tool-result":
        yield { type: "tool_result", toolName: part.toolName, result: part.result };
        break;
      case "text-delta":
        yield { type: "chunk", text: part.textDelta };
        break;
      case "error":
        yield { type: "error", message: part.error.message };
        break;
    }
  }

  // 发 phase 事件：完成
  yield { type: "phase", phase: "done" };
  yield { type: "done", usage: await result.usage };
}
```

**注意这个循环里做了什么、没做什么：**
- ✅ 动态拿工具列表（随配置变化）
- ✅ 限制最大轮次（成本控制）
- ✅ 把所有中间事件 yield 出去（给 Layer 2 用）
- ❌ 没有硬编码任何工具名
- ❌ 没有业务逻辑

### 2.4 System Prompt：AI 的「使用说明书」

```typescript
// agent/prompt.ts
function buildSystemPrompt(config: AppConfig): string {
  let prompt = `你是一个电商助手，可以帮用户查找商品、查询订单。

【重要规则】
- 不要一次性返回大量数据。先用搜索工具获取概览，再按需查详情。
- 如果用户要求修改数据（如取消订单），先确认再执行。
- 你需要判断何时停止收集信息、开始回复用户。`;

  // 条件追加：Web 搜索工具存在时才加使用说明
  if (config.EXA_API_KEY) {
    prompt += `\n- 如果商品信息不完整，可以用 searchWeb 搜索外部信息补充。`;
  }

  return prompt;
}
```

**原则在此体现：**
- 「先概览再详情」→ 原则一
- 「确认再执行」→ 写工具护栏
- 条件追加 Web 说明 → 插槽架构：工具不存在时 AI 根本不知道有这东西

### 2.5 工具设计的五条铁律

工具是 Agent 的「感官」——LLM 通过工具的 `description` 判断该不该用它，通过返回值理解外部世界。工具写得好不好，直接决定 Agent 的能力上限。

**铁律一：`description` 是写给 LLM 看的，不是写给同事看的**

LLM 靠 `description` 判断「该不该调这个工具」。你写得模糊，它就调得不精准。

```typescript
// ❌ 差：太模糊，LLM 不知道什么时候调、能拿到什么
description: "获取商品信息"

// ✅ 好：明确触发场景、返回值范围、不包含什么
description: "根据商品ID获取单个商品详情。返回商品名、价格、库存、规格参数、用户评价摘要（前3条）。用于用户询问某个具体商品时调用。注意：不返回历史价格和同类推荐——如需这些请调 getPriceHistory / getSimilarProducts。"
```

**铁律二：每个 parameter 的 `.describe()` 是给 LLM 的行动指南**

```typescript
// ❌ 差
sortBy: z.string()

// ✅ 好：枚举 + 描述 + 默认值
sortBy: z.enum(["price", "sales", "rating", "newest"])
  .describe("排序方式。price=价格从低到高, sales=销量从高到低, rating=评分从高到低, newest=最新上架")
  .default("sales")
```

**铁律三：返回值「三件套」——结构化、最小化、带提示**

```typescript
// ❌ 差：dump 整行数据库记录，30 个字段，1600 token，其中 25 个 AI 根本不需要
return dbRow;

// ✅ 好：只返回 LLM 需要的字段 + 暗示更多信息可查
return {
  id: "p_042",
  name: "无线降噪耳机 Pro",
  price: 899,
  inStock: true,
  rating: 4.7,
  highlights: ["ANC 主动降噪", "续航 30h"],  // 前 3 个卖点，不是全部
  _hint: "共 12 条评价、3 种颜色可选 ——可用 getProductReviews / getProductVariants 进一步查询"
};
```

`_hint` 是关键技巧——它占不到 30 token，但明确告诉 LLM「还有更多信息可挖掘」，触发下一轮工具调用。这就是**AI 主动加载自己想要的内容**的具体实现：不是你把全部数据塞过去，而是你通过工具的返回值引导它——「你还想知道什么？我这里有。」

**铁律四：一个工具一个职责，别写瑞士军刀**

```typescript
// ❌ 坏设计：一个工具塞太多职能
// getProductData({ id, include: "all" }) → 商品+评价+规格+历史价格+推荐……
// 一次返回 2000 token，LLM 被喂太饱，失去自主判断力

// ✅ 好设计：细粒度工具链，让 LLM 自己决定「我还需要什么」
searchProducts({ keyword })     → 商品列表概览 （80 token/条）
getProductDetail({ id })         → 单条详情     （200 token）
getProductReviews({ id, limit }) → 前 3 条评价  （150 token）
getSimilarProducts({ id })       → 同价位竞品   （200 token）
```

细粒度工具赋予 LLM **自主决定加载什么的能力**——用户问「这款耳机怎么样」，AI 调 `getProductDetail` 就够了（200 token）；用户问「这款耳机和同价位比有优势吗」，AI 会自己调 `getProductDetail` + `getSimilarProducts`（400 token）。信息量随问题复杂度自适应，而不是一刀切全 dump。

**铁律五：工具命名 = 动词 + 名词，一眼看出是读还是写**

```
searchProducts   → 只读，搜索类
getProductDetail → 只读，精确查询
listOrders       → 只读，列表类
updateOrderStatus → 写入，修改状态 ⚠️
cancelOrder      → 写入，危险操作   ⚠️
deleteAccount    → 写入，极度危险   🚫
```

命名本身就有安全语义。注册表可以基于前缀自动分类——`get*` / `search*` / `list*` 安全暴露，`update*` 需要确认，`delete*` 默认不暴露给 AI。

---

### 2.6 上下文管理深水区：别让你的 Agent 被自己撑死

**这是被最多人忽视、也最致命的 Agent 工程问题。**

Context window 是 Agent 最稀缺的资源。一次 Agent 调用的上下文消耗来自 **四个叠加层**：

```
System Prompt     (固定 500~2000 token)
+ 对话历史         (多轮累积，不可控)
+ 每轮 tool_call + tool_result 回填 (5轮 × N个工具 × 返回值 = 关键变量)
+ 最终回复         (流式输出)
─────────────────
= 总消耗
```

**最危险的不是任何一层，而是「工具结果回填」的累积效应。** Agent 循环每执行一轮，tool_call + tool_result 就会作为 `role: "tool"` 消息写进对话历史。5 轮下来，即使每轮只调 1 个工具，也会多出 10 条消息。

举个例子——用户问「我上周买了什么，哪个体验最好」：

```
轮次 1: searchOrders({ userId, dateRange: "上周" })
         → 返回 15 条订单摘要，每条约 8 个字段             = 500 token  ← 回填
轮次 2: getOrderDetail({ id: "o_001" })
         → 完整订单，含物流追踪                           = 300 token  ← 回填
轮次 3: getProductDetail({ id: "p_042" })
         → 完整商品，含规格参数                            = 250 token  ← 回填
轮次 4: getProductReviews({ id: "p_042", limit: 3 })
         → 3 条评价全文                                   = 400 token  ← 回填
──────────────────────────────────────────────────
工具结果回填总量：1450 token ——而且这只是 4 轮！
如果 searchOrders 不是返回摘要而是 dump 每条订单的 30 字段，光这一轮就是 3000 token。
```

**这不是玄学，是可精确计算的工程问题。** 防御体系分三道防线，前两道在代码里，第三道在会话层：

```
┌──────────────────────────────────────────────────┐
│ 第一道防线：概览层 —— 永远不返回完整数据集          │
│                                                  │
│ searchOrders  → 列表摘要（id+名称+价格+状态+日期）  │
│                 不返回：商品详情、物流、评价         │
│ getOrderDetail → 按需返回——                          │
│   「上单买了什么？」→ 只需要 items + 总价            │
│   「为什么延迟？」  → 只需要 logistics + 状态         │
│   同一个工具，根据调用参数可以裁剪不同字段            │
├──────────────────────────────────────────────────┤
│ 第二道防线：工具层 —— 每行 execute 都是防线         │
│                                                  │
│ execute: async ({ id, fields }) => {              │
│   const order = await db.orders.findOne({         │
│     where: { id },                                │
│     select: {                                     │
│       id: true, status: true,                     │
│       items: {                                    │
│         select: {                                 │
│           product: { select: { name: true } },    │
│           price: true, quantity: true             │
│         }                                         │
│       },                                          │
│       totalAmount: true                           │
│       // 只有 6 个字段，不是 30 个                  │
│     }                                             │
│   });                                             │
│                                                   │
│   // 长文本二次截断                                 │
│   if (order.notes && order.notes.length > 200) {  │
│     order.notes = order.notes.slice(0, 200)       │
│       + `...[共${order.notes.length}字]`;          │
│   }                                               │
│                                                   │
│   return order;                                   │
│ }                                                 │
├──────────────────────────────────────────────────┤
│ 第三道防线：会话层 —— 多轮对话天然会累积             │
│                                                  │
│ 策略 A：滑动窗口（简单，但粗暴）                     │
│   只保留最近 N 轮完整消息，更早的直接丢弃            │
│   N = floor((模型上下文 - 3000) / 每轮平均token)    │
│                                                  │
│ 策略 B：摘要注入（推荐，但需要额外一次 LLM 调用）     │
│   每 3 轮用轻量模型（如 gpt-4o-mini）将历史压缩成    │
│   一句摘要，注入到 system prompt 靠前位置：          │
│   "[历史摘要] 用户此前询问了上周购买的耳机使用体验，  │
│    初始反馈噪音较大，现已确认正常。当前在讨论..."     │
│   保留最近 2 轮完整，其余只有摘要（约 100 token）    │
│                                                  │
│ 策略 C：工具结果不保留（激进但有风险）               │
│   tool_result 只保留最新轮次的，历史轮次的丢弃       │
│   风险：LLM 忘了前面查过什么，可能重复查询            │
└──────────────────────────────────────────────────┘
```

**核心认知：上下文管理不是「事后压缩」，而是「事前设计」。** 工具能返回什么、返回多少 token，是在定义工具那一刻就决定了的。上线后发现 context 爆炸、想省 token，往往需要重构工具返回值——那就是真正的技术债。**防上下文爆炸的最好时机，是你写下第一个工具 `execute` 函数的时候。**

---

## 三、Layer 2：流式传输层——SSE 语义事件

### 3.1 为什么不用简单的 text/plain 流？

纯文本流只有一种信息：文字。Agent 的中间过程——调了什么工具、为什么调、调了多久——全部丢失，前端只能干等。

**语义事件协议** 把 AI 的「黑箱思考」变成结构化信号：

| 事件类型 | 何时发出 | 前端行为 |
|----------|---------|---------|
| `phase: collecting` | Agent 开始收集信息 | 显示「思考中…」动画 |
| `tool_call` | AI 决定调用某个工具 | 渲染工具卡片：「正在搜索：XXX」 |
| `tool_result` | 工具执行完毕 | 展示结果摘要 |
| `phase: responding` | AI 开始组织回复 | 切换为「正在生成回复…」 |
| `chunk` | 流式文本块 | 打字机效果追加到聊天区 |
| `done` | 全部完成 | 展示结构化数据、token 用量 |
| `error` | 出错 | 显示错误提示 + 可能的重试 |

### 3.2 把 Layer 1 的 yield 事件转为 SSE 响应

```typescript
// app/api/agent/route.ts
import { runAgent } from "@/agent/loop";

export async function POST(request: Request) {
  const { message } = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function emit(event: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        for await (const event of runAgent(message, getAppConfig())) {
          emit(event);
        }
      } catch (err) {
        emit({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**如果你用 Vercel AI SDK，更简单——直接一行 `result.toDataStreamResponse()`，上面的所有事件类型 SDK 已经内置了。** 但如果你的后端不是 Node 或者你不想引入整个 SDK，上面这个 30 行的 ReadableStream 方案也能跑。

---

## 四、Layer 3：前端——消费事件，不是消费文字

前端不再只是「收到文本就拼上去」，而是变成一个**事件驱动的状态机**。

### 4.1 事件分发器

```typescript
// frontend/hooks/useAgentChat.ts
import { useState, useCallback } from "react";

type UIState = "idle" | "collecting" | "responding" | "error";

export interface ToolCallEvent {
  type: "tool_call";
  toolName: string;
  args: Record<string, any>;
}

export function useAgentChat() {
  const [phase, setPhase] = useState<UIState>("idle");
  const [text, setText] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    setPhase("collecting");
    setText("");
    setToolCalls([]);
    setError(null);

    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));

        switch (event.type) {
          case "phase":
            if (event.phase === "responding") setPhase("responding");
            if (event.phase === "done") setPhase("idle");
            break;
          case "tool_call":
            setToolCalls((prev) => [...prev, event]);
            break;
          case "chunk":
            setText((prev) => prev + event.text);
            break;
          case "error":
            setError(event.message);
            setPhase("error");
            break;
        }
      }
    }
  }, []);

  return { phase, text, toolCalls, error, sendMessage };
}
```

### 4.2 UI 组件：看得见的思考过程

```tsx
// frontend/components/AgentChat.tsx
function AgentChat() {
  const { phase, text, toolCalls, error, sendMessage } = useAgentChat();

  return (
    <div className="agent-chat">
      {/* 思考阶段：展示工具调用进度 */}
      {phase === "collecting" && (
        <div className="thinking-indicator">
          <Spinner />
          <span>AI 正在分析…</span>
          {toolCalls.map((tc, i) => (
            <ToolCallCard key={i} {...tc} />
          ))}
        </div>
      )}

      {/* 输出阶段：打字机效果 */}
      {phase === "responding" && (
        <div className="response markdown-body">
          <Markdown>{text}</Markdown>
          {/* 即使输出中也可能有新工具调用 */}
          {toolCalls.map((tc, i) => (
            <ToolCallCard key={i} {...tc} />
          ))}
        </div>
      )}

      {/* 错误 */}
      {error && <ErrorBanner message={error} />}

      {/* 输入框 */}
      <ChatInput onSend={sendMessage} disabled={phase === "collecting"} />
    </div>
  );
}

function ToolCallCard({ toolName, args }: ToolCallEvent) {
  const labelMap: Record<string, string> = {
    searchProducts: "搜索商品",
    getProductDetail: "获取商品详情",
    searchOrders: "查询订单",
    searchWeb: "搜索网络",
  };

  return (
    <div className="tool-call-card">
      <span className="tool-icon">🔧</span>
      <span className="tool-label">{labelMap[toolName] || toolName}</span>
      <span className="tool-args">{JSON.stringify(args)}</span>
    </div>
  );
}
```

**这份体验的分水岭在于：用户不再对着一片空白等 30 秒，而是看到「正在搜索商品库 → 获取详情 → 查询相关评价」的实时进度。这就是原则五的价值。**

### 4.3 读写闭环：AI 不仅是回答者，还是操作者

上面只是「读」（查数据）。但 Agent 真正打动用户的是「写」——你说「把这条订单取消」，它不只是说「好的，已取消」，而是直接调 `updateOrderStatus` 改了数据库，前端页面的订单列表立刻同步。

**产品层面**：写操作一定加人工确认。

```tsx
function ConfirmableAction({ action }: { action: WriteAction }) {
  const [pending, setPending] = useState(true);

  if (!pending) {
    return <div className="action-done">{action.result}</div>;
  }

  return (
    <div className="action-confirm">
      <span>AI 想执行：{action.description}</span>
      <button onClick={() => { executeAction(action); setPending(false); }}>
        确认执行
      </button>
      <button onClick={() => { rejectAction(action); setPending(false); }}>
        取消
      </button>
    </div>
  );
}
```

---

## 五、从零到一：你的 App 接入路线图

**别一次做全。分五步，每一步都能上线：**

### 阶段 0：盘点——你的 App 有哪些数据 & 操作可被 AI 访问

拿出一张纸（或 Notion），列出：

| 数据/操作 | 类型 | 是否敏感 | 优先级 |
|-----------|------|---------|--------|
| 列表页数据（商品/任务/文档） | 只读 | 否 | P0 |
| 单条详情 | 只读 | 否 | P0 |
| 搜索/筛选 | 只读 | 否 | P0 |
| 创建新记录 | 写入 | 部分 | P1 |
| 修改状态（取消/完成/收藏） | 写入 | 是 | P1 |
| 删除 | 写入 | 高敏感 | P2 |

**这张表就是你的工具设计清单。** P0 的先做，P1 的加护栏，P2 的等验证后再上。

### 阶段 1：最简单的 LLM 对话——零工具

先把 `POST /api/chat` 做出来，纯文本流式对话，一分钟能上线。不涉及 Agent、不涉及工具、不需要复杂架构。

**目标**：验证「你的用户愿意和 AI 对话」这个前提。

### 阶段 2：加第一个工具（只读）

选一个最简单的只读工具——比如「列出最近的 N 条记录」或「按关键词搜索」。这个阶段验证你的工具定义范式、SSE 事件消费是否顺畅。

**代码就是上面 Layer 1/2/3 的最小版本——去掉循环，maxSteps=1。**

### 阶段 3：改造成真正的 Agent（maxSteps > 1）

现在打开多轮工具调用。这是质变——AI 可以「查列表 → 看详情 → 再查另一个维度 → 给出综合结论」。

**但别忘了加上轮次上限（3~5）和工具调用超时（5s），否则一个坏 prompt 能吃光你的 API 费用。**

### 阶段 4：加写工具 + 人工确认

慎重。写工具的 execute 函数里永远加一层权限校验，前端永远加一层确认 UI。原则：**宁可多问一句，不要让 AI 静默改用户数据。**

### 阶段 5：加可观测性

至少做到三条：
- 每次请求记录 `{ userId, message, toolCalls[], totalTokens, duration }`
- 用一个 eval 脚本每周跑 50 条典型问题，打「答案质量」分
- 配一个成本告警：单用户日消耗超过 $X 时通知你

---

## 六、插槽架构实战：加一个「天气预报」工具

假设你的 App 需要支持天气查询。插槽架构下，整个过程三步：

### Step 1：写工具文件

```typescript
// tools/get-weather.ts
import { tool } from "ai";
import { z } from "zod";

export const getWeather = tool({
  description: "获取指定城市当前天气，返回温度、天气状况、湿度（约 50 字）",
  parameters: z.object({
    city: z.string().describe("城市名，如'北京'"),
  }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/v1/current?city=${encodeURIComponent(city)}&key=${process.env.WEATHER_API_KEY}`);
    const data = await res.json();
    // 原则三：只返回关键字段
    return {
      city,
      temperature: data.current.temp_c,
      condition: data.current.condition.text,
      humidity: data.current.humidity,
    };
  },
});
```

### Step 2：往注册表加一行

在 `registry.ts` 里的 `getAllTools()` 加：

```typescript
if (config.WEATHER_API_KEY) {
  tools.getWeather = getWeather;
}
```

### Step 3：Prompt 补一句

在 `buildSystemPrompt()` 里加：

```typescript
if (config.WEATHER_API_KEY) {
  prompt += `\n- 用户询问天气时，可以用 getWeather 工具查询。`;
}
```

**Done。Agent 循环一行没改，其他工具一行没动，前端代码一行没碰。**

「对扩展开放，对修改封闭」——这就是插槽架构。

### 六.1 当工具体系膨胀到 20+ ——分层、过滤、动态暴露

插槽架构让你能无限加工具，但**加得越多，LLM 的选择退化越严重**。

5 个工具时，LLM 选择又快又准。20 个工具时，`description` 互相干扰——LLM 要么漏掉关键工具，要么反复调不该调的。

根源是 attention 竞争：**每多一个工具的 `description`，system prompt 就多一份噪音。**

解法：**分层分域 + 动态暴露。工具库可以无限增长，但 LLM 每次看到的只有 4~8 个。**

**第一层：按业务领域建文件目录**

```
tools/
├── product/               # 商品域
│   ├── search-products.ts
│   ├── get-product-detail.ts
│   └── get-similar-products.ts
├── order/                 # 订单域
│   ├── search-orders.ts
│   ├── get-order-detail.ts
│   ├── cancel-order.ts      # ⚠️ 写工具
│   └── track-shipment.ts
├── user/                  # 用户域
│   ├── get-profile.ts
│   └── get-purchase-history.ts
├── external/              # 外部服务
│   ├── search-web.ts
│   └── get-weather.ts
└── registry.ts            # 唯一的组装入口
```

**第二层：根据用户当前上下文动态挑拣**

```typescript
// tools/registry.ts —— 升级版
export function getAllTools(
  config: AppConfig,
  context?: { currentPage: string; userRole: string }
) {
  // 定义每个域对应的工具集
  const toolsByDomain: Record<string, Record<string, any>> = {
    product: { searchProducts, getProductDetail, getSimilarProducts, getReviews },
    order:   { searchOrders, getOrderDetail, trackShipment },
    user:    { getProfile, getPurchaseHistory },
    chat:    { searchProducts, searchOrders, getProfile },  // 聚合页给少量入口工具
  };

  const domain = context?.currentPage ?? "chat";
  let tools = { ...toolsByDomain[domain] };

  // 条件拼装：外部工具
  if (config.EXA_API_KEY) tools.searchWeb = searchWeb;
  if (config.WEATHER_API_KEY && domain === "chat") tools.getWeather = getWeather;

  // 条件拼装：写工具只对特定域+特定角色暴露
  if (config.ALLOW_AI_WRITE && domain === "order" && context?.userRole === "admin") {
    tools.cancelOrder = cancelOrder;
  }

  return tools;
}
```

**效果量化：**

| 场景 | 用户在哪 | 暴露工具数 | LLM 选择精度 |
|------|---------|-----------|-------------|
| 浏览商品 | `/product/123` | 4 个（商品域） | 高 |
| 查订单 | `/orders` | 3 个（订单域） | 高 |
| 首页聊天 | `/chat` | 3 个（入口工具） | 高 |
| 不用分层 | 任意 | 20 个 | **严重退化** |

**这就是「不留技术债」的真正含义：你不需要控制工具总数，你只需要控制 LLM 在任何时刻看到的工具数量。** 库里的工具有 50 个还是 5 个，对代码质量没有影响——每个工具都是独立文件，互不耦合，注册表按上下文挑拣。未来加任何新功能（天气、日历、支付、通知），都是同一个流程：写文件 → 加一行 → 配上下文规则。架构不会随着工具数量而腐化。

---

## 七、选框架的决策指南

> **关键结论：你不需要从零写 Agent 循环和 SSE 协议。框架已经做好了，你只需定义工具。**

### 按技术栈选

| 你的技术栈 | 推荐框架 | 为什么 |
|-----------|---------|--------|
| **Next.js / React / Node** | Vercel AI SDK | 原生 TypeScript 支持，`streamText` + `tool()` 一行开 agent 循环，`toDataStreamResponse()` 内置完整 SSE 语义协议，`useChat` 自带前端事件消费。生态最完整。 |
| **React 应用 + 想省前端代码** | CopilotKit | 在 Vercel AI SDK 之上封装了 `useCopilotAction`（前端工具）、`useCopilotReadable`（共享状态）、AG-UI 协议。AI 直接操纵你的 React 组件，写工具天然带 HITL 确认。 |
| **Python 后端（FastAPI / Django）** | OpenAI Agents SDK 或 Pydantic AI | OpenAI Agents SDK：轻量级工具注册 + handoff + tracing + guardrails，Provider 无关。Pydantic AI：类型安全。 |
| **复杂的多步骤、需要重试/HITL/分支** | LangGraph（Python/TS） | StateGraph 天然支持 checkpoint 和重试，有 `interrupt()` 做人工确认。LangSmith 提供完整的 trace 和 eval。**能覆盖 Agent 流程中最复杂的错误恢复和可观测性需求。** |
| **不想写循环、想要可视化构建 + API 输出** | Dify（自托管，开源） | 拖拽式构建 Agent 工作流，配好工具后直接暴露 REST API + 内置可观测性面板。适合快速验证，但灵活性不如代码方案。 |
| **检索/知识库密集场景（概览+钻取）** | LlamaIndex（Python/TS） | "先给摘要，按需取详情"这种检索模式就是 LlamaIndex 的 QueryEngine 原生能力。配合 Agent 可以做「先检索再推理」。 |

### 按你要解决的优先级选

| 你最关心什么 | 首选 |
|-------------|------|
| 把代码量降到最低 | Vercel AI SDK |
| AI 能操作我的 React UI | CopilotKit |
| 生产级的错误恢复和重试 | LangGraph |
| 不需要写代码，先跑通流程 | Dify |
| 检索 + Agent 结合 | LlamaIndex + OpenAI Agents SDK |
| 每个 token 的成本都要管 | LangSmith / Helicone |

### 文章 7 精髓 → 框架映射

| 原则 | Vercel AI SDK | CopilotKit | LangGraph | Dify |
|------|:--:|:--:|:--:|:--:|
| 概览+钻取 | ✅ `tool()` return | ✅ | ✅ | ✅ |
| 两阶段分离 | ✅ `fullStream` | ✅ AG-UI | ✅ nodes | ✅ |
| 工具即过滤器 | ✅ execute return | ✅ | ✅ | ✅ |
| 读写闭环 | ✅ write tool | ✅ `useCopilotAction` | ✅ `Command` | ✅ |
| SSE 语义事件 | ✅ Data Stream Protocol | ✅ AG-UI | 需自建 | ✅ |
| 优雅降级 | ✅ `maxSteps` | ✅ | ✅ `config` | ✅ |
| 成本内建 | ✅ `usage` 聚合 | ✅ | ✅ LangSmith | ✅ 面板 |

---

## 八、上线前必查清单

在把 Agent 功能推给用户之前，对着这张表过一遍：

### 硬性安全
- [ ] 写工具的 execute 函数里有**权限校验**（当前用户是否有权执行该操作）
- [ ] 写工具的前端有**人工确认 UI**（不是一键执行）
- [ ] 关键写操作（删除、退款等）完全不暴露给 AI 工具——人工操作
- [ ] 工具隔离：一个工具的异常不影响其他工具的返回

### 成本控制
- [ ] 设置 `maxSteps`（建议 3~5，复杂场景不超过 8）
- [ ] 每个工具调用有**超时**（建议 5~10 秒）
- [ ] 同一 session 内相同参数的工具调用有**缓存**（TTL 按数据时效设）
- [ ] 记录每次请求的 **totalTokens**，用于按用户/按天的成本分析
- [ ] 设置**单用户日消耗上限**告警

### 可观测性
- [ ] 每次 Agent 调用的 trace 日志包含：`{ user, input, toolCalls[], steps, totalTokens, duration, error }`
- [ ] 每周用固定测试集跑一次 eval，记录「回答质量」变化
- [ ] 工具错误有独立的告警通道（工具挂了 Agent 仍应降级回复）

### 数据时效
- [ ] 读工具的缓存 TTL 匹配数据变更频率（订单缓存 30s，商品缓存 5min）
- [ ] 写操作**永远不缓存**——每次真实执行
- [ ] 数据更新后**主动失效**相关读缓存

### Context Window 管理
- [ ] 每轮工具返回结果做**字段裁剪**（只留 AI 需要的字段，不 dump 整行）
- [ ] 长文本结果做 **summary 截断**（如只保留前 500 字符 + 总数提示）
- [ ] 历史对话做**滑动窗口或摘要压缩**（只保留最近 N 轮完整、更早的压缩成摘要）

### 降级
- [ ] 所有工具挂了 → Agent 退化为纯对话，给用户友好提示
- [ ] LLM API 超时或不可用 → 前端展示重试按钮，不白屏
- [ ] 单工具超时 → 只跳过该工具，Agent 继续用其他工具完成任务

---

## 结语

**AI Agent 嵌入 App 不是遥不可及的东西。本质上就三板斧：**

1. **把 App 的数据和操作定义成工具**（schema + executor + 最小返回值）
2. **把工具注册到一个循环里**（Agent 自己决定先调哪个后调哪个）
3. **用语义事件把过程喂给前端**（用户看得见 AI 在做什么）

**你的任务：拿出上面阶段的「数据/操作盘点表」，勾 3 个 P0 工具，选好框架，从阶段 1 的纯对话做起。一周内上线第一个 Agent 功能。**

如果你用的是 Next.js，`npx create-next-app@latest` 然后装 `ai` `@ai-sdk/openai`，抄上面 Layer 1/2/3 的代码，改动不超过 100 行你就能跑起来。比你以为的简单得多。

---

*本文参考了 Vercel AI SDK、CopilotKit、LangGraph、OpenAI Agents SDK、Dify 的官方文档及社区实践。文中代码示例为架构示意，完整可跑版本见各框架 Quick Start。*
