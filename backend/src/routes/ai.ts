/**
 * AI 相关路由
 *
 * 包含：
 * - 非流式端点：classify, recommend, category-advice, insight, reading-path, reorganize
 * - SSE 流式端点：recommend/stream, insight/stream, reading-path/stream,
 *   book-qa/stream, reading-insights/stream, profile/stream,
 *   compare-books/stream, reading-summary/stream,
 *   notes/stream, chat/stream
 * - 推荐采纳反馈：POST/GET recommend-feedback（想读 / 跳过，落 SQLite）
 *
 * 两类端点的书库来源不同，这是有意为之：
 * - 非流式端点只发一次补全、不带工具循环，改不了库，沿用请求里携带的数据即可
 * - 流式端点跑 Agent 工具循环（可读可写），书库与画像一律服务端从 SQLite 载入，
 *   客户端传什么都不作数，见 createAgentContext
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  classifyBooks,
  getRecommendations,
  getCategoryFocusedAdvice,
  generateInsight,
  generateReadingPath,
  reorganizeLibrary,
  // 流式函数
  getRecommendationsStream,
  generateInsightStream,
  generateReadingPathStream,
  chatWithBookStream,
  generateReadingInsightsStream,
  analyzeUserProfileStream,
  compareBooksStream,
  generateReadingSummaryStream,
  organizeNotesStream,
  readingAssistantStream,
  AgentHandlers,
} from '../services/aiService';
import { createAgentContext } from '../services/libraryTools';
import { addRecommendationFeedback, listRecommendationFeedback } from '../db/database';
import { AppError, ErrorCode } from '../types';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 所有 AI 路由都需要登录
router.use(requireAuth);

// ============================================================================
// SSE 辅助函数 — 确保真正的流式输出 + 客户端断开检测
// ============================================================================

/** 初始化 SSE 响应头 */
function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

/** 写入 SSE 数据并立即 flush */
function writeSSE(res: Response, data: any): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }
}

/**
 * 创建请求级别的 AbortController
 * 当客户端断开 SSE 连接时，自动 abort AI 调用
 */
function createRequestAbort(_req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  let responseFinished = false;
  // finish: res.end() 调用后触发（正常结束）
  res.on('finish', () => { responseFinished = true; });
  // close: 连接关闭时触发（可能是正常结束后，也可能是客户端断开）
  // 只有在非正常结束时才 abort
  res.on('close', () => {
    if (!responseFinished && !controller.signal.aborted) {
      console.log('[AI] 客户端断开连接，abort AI 调用');
      controller.abort();
    }
  });
  return controller.signal;
}

/**
 * 每个流式端点都要把同一组回调接到 SSE 上。
 *
 * `onBookUpdate` 对全部端点一律接上：Agent 的写操作现在直接落 SQLite，
 * 客户端只有收到 book_update 才知道哪本书被改过，否则它下一次全量保存会把
 * 刚写入的状态冲掉。漏接一个端点就是静默丢数据，所以这里不做取舍。
 */
function sseHandlers(res: Response, signal: AbortSignal): AgentHandlers {
  return {
    onChunk: (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
    onPhase: (phase) => writeSSE(res, { type: 'phase', phase }),
    onToolCall: (tool, label, round) => writeSSE(res, { type: 'tool_call', tool, label, round }),
    onReasoning: (text) => writeSSE(res, { type: 'reasoning', content: text }),
    onBookUpdate: (bookId, updates) => writeSSE(res, { type: 'book_update', bookId, updates }),
    signal,
  };
}

// ============================================================================
// 验证中间件 — 返回 Zod 具体错误信息
// ============================================================================

const validate = (schema: z.ZodSchema) => (req: any, _res: any, next: any) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errorDetails = result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    next(new AppError(ErrorCode.VALIDATION_ERROR, '请求参数验证失败', 400, { issues: errorDetails }));
    return;
  }
  req.body = result.data;
  next();
};

// ============================================================================
// 共享子 schema
// ============================================================================

const conversationHistorySchema = z.array(z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
}));

const categoryContextSchema = z.object({
  currentCategory: z.string(),
  parentCategories: z.array(z.string()),
  siblingCategories: z.array(z.string()),
  subCategories: z.array(z.string()),
  booksInContext: z.array(z.any()),
  totalBooks: z.number(),
  readingStats: z.object({
    reading: z.number(),
    finished: z.number(),
    unread: z.number(),
  }),
});

const readingStatsDataSchema = z.object({
  totalBooks: z.number(),
  readingCount: z.number(),
  finishedCount: z.number(),
  unreadCount: z.number(),
  totalPagesRead: z.number(),
  categoryDistribution: z.array(z.object({ category: z.string(), count: z.number() })),
  levelDistribution: z.object({ Basic: z.number(), Advanced: z.number(), Expert: z.number() }),
});

// ============================================================================
// 非流式端点 — 无工具循环，书库仍来自请求体
// ============================================================================

// 批量分类书籍
const classifySchema = z.object({
  titles: z.array(z.string()).min(1).max(50),
  existingCategories: z.array(z.string()).optional(),
});

router.post('/classify', validate(classifySchema), async (req, res, next) => {
  try {
    const { titles, existingCategories } = req.body;
    const result = await classifyBooks(titles, existingCategories);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 个性化推荐
const recommendSchema = z.object({
  userRequest: z.string().min(1).max(1000),
  userMood: z.string().nullable().optional(),
  userProfile: z.object({
    nickname: z.string().optional(),
    readingLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    readingGoal: z.string().optional(),
    preferredCategories: z.array(z.string()).optional(),
    dailyReadingTime: z.number().optional(),
    aiAnalysis: z.object({
      inferredLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
      readingPattern: z.string(),
      blindSpots: z.array(z.string()),
      recommendedFocus: z.string(),
      lastUpdated: z.string(),
    }).optional(),
  }).optional(),
  library: z.array(z.any()),
  categoryContext: categoryContextSchema.optional(),
  conversationHistory: conversationHistorySchema.optional(),
});

router.post('/recommend', validate(recommendSchema), async (req, res, next) => {
  try {
    const result = await getRecommendations(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 分类专项对话
const categoryAdviceSchema = z.object({
  category: z.string(),
  subcategory: z.string().optional(),
  books: z.array(z.any()).min(1),
  userQuestion: z.string().min(1),
});

router.post('/category-advice', validate(categoryAdviceSchema), async (req, res, next) => {
  try {
    const { category, subcategory, books, userQuestion } = req.body;
    const result = await getCategoryFocusedAdvice(category, subcategory, books, userQuestion);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 生成书籍解读
// 两个端点都不需要客户端传 library：非流式版压根不用，流式版服务端自己载入
const insightSchema = z.object({
  title: z.string(),
  author: z.string(),
  level: z.enum(['Basic', 'Advanced', 'Expert']),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  totalPages: z.number().optional(),
  doubanData: z.object({
    rating: z.number().optional(),
    ratingCount: z.number().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publisher: z.string().optional(),
    pubdate: z.string().optional(),
  }).optional(),
});

router.post('/insight', validate(insightSchema), async (req, res, next) => {
  try {
    const result = await generateInsight(
      req.body.title,
      req.body.author,
      req.body.level,
      req.body.category,
      req.body.subcategory,
      req.body.totalPages,
      req.body.doubanData
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 规划阅读路径
// books 是用户在界面上勾选的那批书，属请求数据而非书库真源，两个端点都保留
const pathSchema = z.object({
  books: z.array(z.any()).min(1),
  category: z.string(),
  subcategory: z.string().optional(),
  customRequirements: z.string().optional(),
});

router.post('/reading-path', validate(pathSchema), async (req, res, next) => {
  try {
    const { books, category, subcategory, customRequirements } = req.body;
    const result = await generateReadingPath(books, category, subcategory, customRequirements);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 智能整理书库
const reorganizeSchema = z.object({
  books: z.array(z.any()).min(1),
});

router.post('/reorganize', validate(reorganizeSchema), async (req, res, next) => {
  try {
    const result = await reorganizeLibrary(req.body.books);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SSE 流式端点 — 逐块推送 AI 文本 + 客户端断开自动取消
// ============================================================================

// 流式个性化推荐：书库与画像由服务端载入，客户端只交请求和上下文
const recommendStreamSchema = z.object({
  userRequest: z.string().min(1).max(1000),
  userMood: z.string().nullable().optional(),
  categoryContext: categoryContextSchema.optional(),
  conversationHistory: conversationHistorySchema.optional(),
});

router.post('/recommend/stream', validate(recommendStreamSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log(`[AI] recommend/stream 开始处理, library size: ${ctx.library.length}`);
    const result = await getRecommendationsStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// ============================================================================
// 推荐采纳反馈 — 卡片上的「想读 / 跳过」
//
// 这是"推得准不准"目前唯一能拿到的客观信号：提示词、模型评分都是自评。
// 只记显式点击，不记展示了哪些，所以还算不出严格采纳率（缺分母）。
// ============================================================================

const recommendationFeedbackSchema = z.object({
  requestId: z.string().max(64).optional(),
  items: z.array(z.object({
    bookId: z.string().max(64).optional(),
    title: z.string().min(1).max(200),
    source: z.enum(['library', 'external']),
    action: z.enum(['want', 'skip']),
    category: z.string().max(60).optional(),
    reason: z.string().max(1000).optional(),
  })).min(1).max(30),
});

router.post('/recommend-feedback', validate(recommendationFeedbackSchema), (req, res) => {
  const { requestId, items } = req.body;
  // requestId 在顶层（一次推荐一个），要摊到每条反馈上才能归组——
  // 不摊就会静默存成 NULL，事后想按次分析就没有任何依据
  const recorded = addRecommendationFeedback(req.user!.id, items.map((item: any) => ({ ...item, requestId })));
  res.json({ success: true, data: { recorded, requestId: requestId ?? null } });
});

router.get('/recommend-feedback', (req, res) => {
  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw) && raw > 0 ? raw : 100;
  res.json({ success: true, data: listRecommendationFeedback(req.user!.id, limit) });
});

// 流式生成书籍解读
router.post('/insight/stream', validate(insightSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] insight/stream 开始:', req.body.title);
    const result = await generateInsightStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    console.error('[AI] insight/stream 错误:', error.message);
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 流式规划阅读路径
router.post('/reading-path/stream', validate(pathSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] reading-path/stream 开始:', req.body.category);
    const result = await generateReadingPathStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// ============================================================================
// AI 阅读助手 & 阅读洞察 — SSE 流式端点
// ============================================================================

// 书籍问答（流式）
const bookQASchema = z.object({
  question: z.string().min(1).max(2000),
  bookContext: z.object({
    title: z.string(),
    author: z.string(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    level: z.string().optional(),
    aiInsight: z.object({
      summary: z.string().optional(),
      advice: z.string().optional(),
      keyChapters: z.array(z.string()).optional(),
    }).optional(),
    doubanData: z.object({
      summary: z.string().optional(),
      rating_score: z.number().optional(),
      tags: z.array(z.string()).optional(),
    }).optional(),
    readingProgress: z.object({
      currentPage: z.number(),
      totalPages: z.number(),
      percentage: z.number(),
    }).optional(),
  }),
  conversationHistory: conversationHistorySchema.optional(),
});

router.post('/book-qa/stream', validate(bookQASchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log(`[AI] book-qa/stream 开始: ${req.body.question?.slice(0, 50)} (library ${ctx.library.length})`);
    const fullText = await chatWithBookStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: fullText });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 阅读洞察（流式）
const insightsSchema = readingStatsDataSchema.extend({
  avgRating: z.number(),
  readingBooks: z.array(z.object({
    title: z.string(), author: z.string(), progress: z.number(), category: z.string(),
  })),
  finishedBooks: z.array(z.object({
    title: z.string(), author: z.string(), category: z.string(),
  })),
});

router.post('/reading-insights/stream', validate(insightsSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] reading-insights/stream 开始, books:', req.body.totalBooks);
    const result = await generateReadingInsightsStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 用户画像分析（流式）
const profileSchema = readingStatsDataSchema.extend({
  readingBooks: z.array(z.object({
    title: z.string(), author: z.string(), progress: z.number(),
    category: z.string(), level: z.string(),
  })),
  finishedBooks: z.array(z.object({
    title: z.string(), author: z.string(), category: z.string(), level: z.string(),
  })),
  currentProfile: z.object({
    readingLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
    readingGoal: z.string().optional(),
    preferredCategories: z.array(z.string()),
  }).optional(),
});

router.post('/profile/stream', validate(profileSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] profile/stream 开始, books:', req.body.totalBooks);
    const result = await analyzeUserProfileStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// ============================================================================
// 书籍对比 & 读书总结 — SSE 流式端点
// ============================================================================

// 书籍对比（流式）：books 是要对比的那几本，由客户端挑选
const compareBooksSchema = z.object({
  books: z.array(z.any()).min(2).max(4),
});

router.post('/compare-books/stream', validate(compareBooksSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] compare-books/stream 开始, books:', req.body.books?.length);
    const result = await compareBooksStream(ctx, req.body.books, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 读书总结（流式）
const readingSummarySchema = z.object({
  title: z.string(),
  author: z.string(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  level: z.string().optional(),
  totalPages: z.number().optional(),
  rating: z.number().optional(),
  aiInsight: z.object({
    summary: z.string().optional(),
    advice: z.string().optional(),
    keyChapters: z.array(z.string()).optional(),
  }).optional(),
  doubanData: z.object({
    rating_score: z.number().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  readingProgress: z.object({
    startDate: z.string().optional(),
    completionDate: z.string().optional(),
    totalPages: z.number().optional(),
  }).optional(),
});

router.post('/reading-summary/stream', validate(readingSummarySchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] reading-summary/stream 开始:', req.body.title);
    const result = await generateReadingSummaryStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// ============================================================================
// 笔记整理 & 全局阅读助手 — SSE 流式端点
// ============================================================================

// 笔记整理（流式）
const notesOrganizeSchema = z.object({
  bookTitle: z.string().min(1),
  bookAuthor: z.string().optional(),
  notes: z.array(z.object({
    id: z.number(),
    content: z.string().min(1),
    type: z.string().optional(),
  })).min(1),
});

router.post('/notes/stream', validate(notesOrganizeSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log('[AI] notes/stream 开始:', req.body.bookTitle);
    const result = await organizeNotesStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 全局阅读助手（流式）
const chatSchema = z.object({
  question: z.string().min(1).max(5000),
  conversationHistory: conversationHistorySchema.optional(),
});

router.post('/chat/stream', validate(chatSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const ctx = createAgentContext(req.user!.id);
    console.log(`[AI] chat/stream 开始: ${req.body.question?.slice(0, 50)} (library ${ctx.library.length})`);
    const result = await readingAssistantStream(ctx, req.body, sseHandlers(res, signal));
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

export default router;
