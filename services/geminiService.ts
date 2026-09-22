/**
 * AI 服务 - 前端版本
 * 
 * 调用后端 API 进行 AI 操作
 */

import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation, AdvisorResponse } from "../types";
import { API_BASE, authHeader } from "./authService";

// ============================================================================
// SSE 流式辅助类型 & 通用解析器
// ============================================================================

/** 对话消息类型 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** API 错误类 */
export class ApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 用户画像分析结果 */
export interface ProfileAnalysisResult {
  inferredLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  readingPattern: string;
  blindSpots: string[];
  recommendedFocus: string;
}

/** 兼容旧版 recommendBooks 导出 */
export async function recommendBooks(
  books: Book[],
  category: string,
  subcategory?: string | null,
  requirements?: string,
): Promise<Recommendation[]> {
  const response = await getPersonalizedRecommendations(
    requirements || `我想在 ${category}${subcategory ? ` > ${subcategory}` : ''} 领域找书`,
    books,
  );
  return response.externalMatches || [];
}

export interface StreamCallbacks {
  onPhase?: (phase: 'thinking' | 'generating') => void;
  onToolCall?: (toolName: string, label: string, round: number) => void;
  onChunk?: (chunk: string) => void;
  onDone?: (data: any) => void;
  onError?: (message: string) => void;
  onReasoning?: (text: string) => void;
  onBookUpdate?: (bookId: string, updates: any) => void;
}

/**
 * 通用 SSE 流式请求解析器
 * 
 * 解析后端推送的 { type: 'phase' | 'tool_call' | 'chunk' | 'done' | 'error' } 事件
 */
async function parseSSEStream(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: any = null;

  while (true) {
    if (signal?.aborted) {
      reader.cancel();
      break;
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        let event: any;
        try {
          event = JSON.parse(jsonStr);
        } catch {
          // 只吞帧解析失败；回调与后端 error 事件抛出的错误必须传播出去
          continue;
        }
        switch (event.type) {
          case 'phase':
            callbacks.onPhase?.(event.phase);
            break;
          case 'tool_call':
            callbacks.onToolCall?.(event.tool, event.label, event.round);
            break;
          case 'chunk':
            callbacks.onChunk?.(event.content);
            break;
          case 'reasoning':
            callbacks.onReasoning?.(event.content);
            break;
          case 'book_update':
            callbacks.onBookUpdate?.(event.bookId, event.updates);
            break;
          case 'done':
            result = event.data;
            callbacks.onDone?.(event.data);
            break;
          case 'error':
            callbacks.onError?.(event.message);
            throw new Error(event.message);
        }
      }
    }
  }

  return result;
}

/**
 * 通用 SSE 流式请求函数
 */
async function fetchSSEStream(
  endpoint: string,
  body: any,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  const url = `${API_BASE}/ai/${endpoint}`;
  console.log(`[Frontend] → POST ${endpoint}  @ ${new Date().toLocaleTimeString()}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    signal,
  });
  console.log(`[Frontend] ← ${endpoint} response: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return parseSSEStream(response, callbacks, signal);
}

// ============================================================================
// 流式 API 函数
// ============================================================================

/**
 * 流式个性化推荐
 *
 * 书库与画像不在参数里：流式端点跑 Agent 工具循环、可读写书库，
 * 后端一律从 SQLite 载入，客户端传了也不作数。
 */
export async function getRecommendationsStream(
  context: {
    userRequest: string;
    userMood?: string;
    categoryContext?: any;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('recommend/stream', context, callbacks, signal);
}

// ============================================================================
// 推荐采纳反馈 — 卡片上的「想读 / 跳过」
// ============================================================================

export interface RecommendationFeedbackItem {
  bookId?: string;
  title: string;
  source: 'library' | 'external';
  action: 'want' | 'skip';
  category?: string;
  reason?: string;
}

/**
 * 上报用户对某条推荐的显式态度。
 * 返回 false 而不是抛错：这是评估数据，不该因为一次上报失败就弹错误框，
 * 调用方拿返回值把按钮状态回滚即可。
 */
export async function sendRecommendationFeedback(
  items: RecommendationFeedbackItem[],
  requestId?: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/ai/recommend-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ requestId, items }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 流式生成书籍解读
 */
export async function generateInsightStream(
  data: {
    title: string;
    author: string;
    level: BookLevel;
    category?: string;
    subcategory?: string;
    totalPages?: number;
    doubanData?: any;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<AIInsight> {
  return fetchSSEStream('insight/stream', data, callbacks, signal);
}

/**
 * 流式规划阅读路径
 */
export async function generateReadingPathStream(
  data: {
    books: Book[];
    category: string;
    subcategory?: string;
    customRequirements?: string;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<ReadingPathResponse> {
  return fetchSSEStream('reading-path/stream', data, callbacks, signal);
}

/**
 * 书籍问答（流式）
 */
export async function chatWithBookStream(
  data: {
    question: string;
    bookContext: {
      title: string;
      author: string;
      category?: string;
      subcategory?: string;
      level?: string;
      aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
      doubanData?: { summary?: string; rating_score?: number; tags?: string[] };
      readingProgress?: { currentPage: number; totalPages: number; percentage: number };
    };
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  return fetchSSEStream('book-qa/stream', data, callbacks, signal);
}

/**
 * 阅读洞察（流式）
 */
export async function generateReadingInsightsStream(
  data: {
    totalBooks: number;
    readingCount: number;
    finishedCount: number;
    unreadCount: number;
    totalPagesRead: number;
    avgRating: number;
    categoryDistribution: Array<{ category: string; count: number }>;
    levelDistribution: { Basic: number; Advanced: number; Expert: number };
    readingBooks: Array<{ title: string; author: string; progress: number; category: string }>;
    finishedBooks: Array<{ title: string; author: string; category: string }>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('reading-insights/stream', data, callbacks, signal);
}

/**
 * 用户画像分析（流式）
 */
export async function analyzeUserProfileStream(
  data: {
    totalBooks: number;
    readingCount: number;
    finishedCount: number;
    unreadCount: number;
    totalPagesRead: number;
    categoryDistribution: Array<{ category: string; count: number }>;
    levelDistribution: { Basic: number; Advanced: number; Expert: number };
    readingBooks: Array<{ title: string; author: string; progress: number; category: string; level: string }>;
    finishedBooks: Array<{ title: string; author: string; category: string; level: string }>;
    currentProfile?: {
      readingLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
      readingGoal?: string;
      preferredCategories: string[];
    };
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('profile/stream', data, callbacks, signal);
}

/**
 * 书籍对比（流式）
 */
export async function compareBooksStream(
  data: {
    books: any[];
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('compare-books/stream', data, callbacks, signal);
}

/**
 * 读书总结（流式）
 */
export async function generateReadingSummaryStream(
  data: {
    title: string;
    author: string;
    category?: string;
    subcategory?: string;
    level?: string;
    totalPages?: number;
    rating?: number;
    aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
    doubanData?: { rating_score?: number; summary?: string; tags?: string[] };
    readingProgress?: { startDate?: string; completionDate?: string; totalPages?: number };
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('reading-summary/stream', data, callbacks, signal);
}

/**
 * 笔记整理（流式）
 */
export async function organizeNotesStream(
  data: {
    bookTitle: string;
    bookAuthor?: string;
    notes: Array<{ id: number; content: string; type?: string }>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<any> {
  return fetchSSEStream('notes/stream', data, callbacks, signal);
}

/**
 * 全局阅读助手（流式）
 *
 * 跨书库自由对话，不绑定单本书。书库与画像由后端从 SQLite 载入
 */
export async function readingAssistantStream(
  data: {
    question: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  return fetchSSEStream('chat/stream', data, callbacks, signal);
}

// Helper to chunk array for batch processing
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

/**
 * 批量分析书籍（调用后端 API）
 */
export async function analyzeBookBatch(
  titles: string[],
  existingCategories: string[] = []
): Promise<Partial<Book>[]> {
  const response = await fetch(`${API_BASE}/ai/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ titles, existingCategories }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '分类失败');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 获取个性化推荐（调用后端 API）
 */
export async function getPersonalizedRecommendations(
  context: string,
  library: Book[]
): Promise<AdvisorResponse> {
  const response = await fetch(`${API_BASE}/ai/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({
      library,
      userRequest: context,
      userMood: 'focused',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '推荐失败');
  }

  const json = await response.json();
  return json.data ?? json;
}

/**
 * 生成书籍解读（调用后端 API）
 * 传入完整的豆瓣数据以获得更精准的解读
 */
export async function generateBookInsight(
  title: string,
  author: string,
  level: BookLevel,
  category?: string,
  subcategory?: string,
  totalPages?: number,
  doubanData?: {
    rating?: number;
    ratingCount?: number;
    summary?: string;
    tags?: string[];
    publisher?: string;
    pubdate?: string;
  }
): Promise<AIInsight> {
  const response = await fetch(`${API_BASE}/ai/insight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ 
      title, 
      author, 
      level, 
      category, 
      subcategory, 
      totalPages,
      doubanData 
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '生成解读失败');
  }

  const result = await response.json();
  // 后端返回 { success: true, data: AIInsight }
  return result.data || result;
}

/**
 * 规划阅读路径（调用后端 API）
 */
export async function generateReadingPath(
  books: Book[],
  category: string,
  subcategory?: string,
  customRequirements?: string
): Promise<ReadingPathResponse> {
  const response = await fetch(`${API_BASE}/ai/reading-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ books, category, subcategory, customRequirements }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '规划路径失败');
  }

  const json = await response.json();
  return json.data ?? json;
}

/**
 * 智能整理书库（调用后端 API）
 */
export async function reorganizeLibrary(
  books: Book[]
): Promise<Record<string, { category: string; subcategory: string; tags?: string[] }>> {
  const response = await fetch(`${API_BASE}/ai/reorganize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ books }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '整理失败');
  }

  const json = await response.json();
  return json.data ?? json;
}

/**
 * 搜索豆瓣书籍（调用后端 API）
 */
export async function searchDoubanBooks(query: string): Promise<any[]> {
  const response = await fetch(`${API_BASE}/douban/search?q=${encodeURIComponent(query)}`, {
    headers: authHeader(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '搜索失败');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 智能查找书籍（根据书名，缓存优先）
 * 
 * 流程：
 * 1. 先查 cache.json → 有则直接用
 * 2. 没有则实时抓取 → 存入缓存
 */
export async function findBookByTitle(title: string): Promise<{ book: any; comments: any[] } | null> {
  const response = await fetch(`${API_BASE}/douban/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ title }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '查找失败');
  }

  const data = await response.json();
  return data.data;
}

// Debug logging (保留但简化)
let debugLogs: any[] = [];

export const getDebugLogs = () => [...debugLogs];
export const clearDebugLogs = () => { debugLogs = []; };
