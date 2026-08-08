/**
 * AI 相关路由
 *
 * 包含：
 * - 非流式端点：classify, recommend, category-advice, insight, reading-path, reorganize
 * - SSE 流式端点：recommend/stream, insight/stream, reading-path/stream,
 *   book-qa/stream, reading-insights/stream, profile/stream,
 *   compare-books/stream, reading-summary/stream,
 *   notes/stream, chat/stream
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
} from '../services/aiService';
import { AppError, ErrorCode } from '../types';

const router = Router();

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
function createRequestAbort(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  const onClose = () => {
    controller.abort();
  };
  req.on('close', onClose);
  res.on('close', onClose);
  res.on('finish', () => {
    req.off('close', onClose);
    res.off('close', onClose);
  });
  return controller.signal;
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
// 非流式端点
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
  categoryContext: z.object({
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
  }).optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
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
  library: z.array(z.any()).optional(),
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

// 流式个性化推荐
router.post('/recommend/stream', validate(recommendSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await getRecommendationsStream(
      req.body,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 流式生成书籍解读
router.post('/insight/stream', validate(insightSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await generateInsightStream(
      req.body.title, req.body.author, req.body.level,
      req.body.category, req.body.subcategory, req.body.totalPages,
      req.body.doubanData,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      req.body.library,
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 流式规划阅读路径
router.post('/reading-path/stream', validate(pathSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const { books, category, subcategory, customRequirements } = req.body;
    const result = await generateReadingPathStream(
      books, category, subcategory, customRequirements,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
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
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
  library: z.array(z.any()).optional(),
});

router.post('/book-qa/stream', validate(bookQASchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const { question, bookContext, conversationHistory, library } = req.body;
    const fullText = await chatWithBookStream(
      question, bookContext, conversationHistory || [],
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      signal, library,
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      undefined,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
    writeSSE(res, { type: 'done', data: fullText });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 阅读洞察（流式）
const insightsSchema = z.object({
  totalBooks: z.number(),
  readingCount: z.number(),
  finishedCount: z.number(),
  unreadCount: z.number(),
  totalPagesRead: z.number(),
  avgRating: z.number(),
  categoryDistribution: z.array(z.object({ category: z.string(), count: z.number() })),
  levelDistribution: z.object({ Basic: z.number(), Advanced: z.number(), Expert: z.number() }),
  readingBooks: z.array(z.object({
    title: z.string(), author: z.string(), progress: z.number(), category: z.string(),
  })),
  finishedBooks: z.array(z.object({
    title: z.string(), author: z.string(), category: z.string(),
  })),
  library: z.array(z.any()),
});

router.post('/reading-insights/stream', validate(insightsSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await generateReadingInsightsStream(
      req.body, req.body.library,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

// 用户画像分析（流式）
const profileSchema = z.object({
  totalBooks: z.number(),
  readingCount: z.number(),
  finishedCount: z.number(),
  unreadCount: z.number(),
  totalPagesRead: z.number(),
  categoryDistribution: z.array(z.object({ category: z.string(), count: z.number() })),
  levelDistribution: z.object({ Basic: z.number(), Advanced: z.number(), Expert: z.number() }),
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
  library: z.array(z.any()),
});

router.post('/profile/stream', validate(profileSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await analyzeUserProfileStream(
      req.body, req.body.library,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
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

// 书籍对比（流式）
const compareBooksSchema = z.object({
  books: z.array(z.any()).min(2).max(4),
  library: z.array(z.any()),
});

router.post('/compare-books/stream', validate(compareBooksSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await compareBooksStream(
      req.body.books, req.body.library,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
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
  userProfile: z.object({
    readingLevel: z.string().optional(),
    readingGoal: z.string().optional(),
    preferredCategories: z.array(z.string()).optional(),
  }).optional(),
  library: z.array(z.any()),
});

router.post('/reading-summary/stream', validate(readingSummarySchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await generateReadingSummaryStream(
      req.body, req.body.library,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
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
  library: z.array(z.any()).optional(),
});

router.post('/notes/stream', validate(notesOrganizeSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await organizeNotesStream(
      {
        bookTitle: req.body.bookTitle,
        bookAuthor: req.body.bookAuthor,
        notes: req.body.notes,
      },
      req.body.library || [],
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      signal,
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
    );
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
  library: z.array(z.any()),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
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
});

router.post('/chat/stream', validate(chatSchema), async (req, res) => {
  initSSE(res);
  const signal = createRequestAbort(req, res);
  try {
    const result = await readingAssistantStream(
      req.body.question,
      req.body.library,
      req.body.conversationHistory || [],
      req.body.userProfile,
      (chunk) => writeSSE(res, { type: 'chunk', content: chunk }),
      (phase) => writeSSE(res, { type: 'phase', phase }),
      (toolName, label, round) => writeSSE(res, { type: 'tool_call', tool: toolName, label, round }),
      (text) => writeSSE(res, { type: 'reasoning', content: text }),
      signal,
      (bookId, updates) => writeSSE(res, { type: 'book_update', bookId, updates }),
    );
    writeSSE(res, { type: 'done', data: result });
    res.end();
  } catch (error: any) {
    if (signal.aborted) return;
    writeSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

export default router;
