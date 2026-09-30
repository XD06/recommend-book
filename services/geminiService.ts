/**
 * AI 服务 - 前端版本
 * 
 * 调用后端 API 进行 AI 操作
 */

import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation, AdvisorResponse, UserProfile } from "../types";
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

// ============================================================================
// 对话历史持久化 — 会话记忆落 SQLite
//
// 此前历史只存在 localStorage、还只留最后 10 轮：换设备或清缓存就归零，
// 提示词里"记住用户说过的信息、下次围绕这个目标"其实无从谈起。
// 后端 conversations 表早就建好（含索引），这里补上前端读写口。
// ============================================================================

export type ConversationType = 'ai_advisor' | 'reading_assistant' | 'book_qa';

export interface StoredConversation {
  id: string;
  bookId: string | null;
  type: string;
  /** 内容形状由调用方决定（AI 顾问存的是 ChatTurn[]，不是扁平的 role/content） */
  messages: any[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchConversation(
  type: ConversationType = 'ai_advisor',
  bookId?: string,
): Promise<StoredConversation | null> {
  const qs = new URLSearchParams({ type });
  if (bookId) qs.set('bookId', bookId);
  const res = await fetch(`${API_BASE}/ai/conversation?${qs.toString()}`, { headers: authHeader() });
  if (!res.ok) throw new Error('获取对话历史失败');
  const data = await res.json();
  return data?.data ?? null;
}

/** 保存会话。返回 false 而不抛错：写失败不该打断对话，本地那份镜像还在 */
export async function saveConversation(
  messages: any[],
  type: ConversationType = 'ai_advisor',
  bookId?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/ai/conversation`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ type, bookId: bookId ?? null, messages }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearConversationOnServer(
  type: ConversationType = 'ai_advisor',
  bookId?: string,
): Promise<boolean> {
  try {
    const qs = new URLSearchParams({ type });
    if (bookId) qs.set('bookId', bookId);
    const res = await fetch(`${API_BASE}/ai/conversation?${qs.toString()}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// 回合后的画像抽取与撤销
//
// 顾问回答完再单独问一次"用户这句话里有没有稳定的画像信息"，写进 user_profiles。
// 不依赖模型在回答时自觉落盘（实测那条路 27 次请求 0 次调用）。后端有两道零成本
// 闸门：顾问本轮已落盘 → 跳过；用户消息没命中自述正则 → 跳过（不花这笔调用）。
// 异步路径一律记为 AI 来源，因此覆盖不了用户自己填的字段。
// ============================================================================

export interface ExtractResult {
  skipped: boolean;
  reason?: string;
  written: string[];
  refused: Array<{ field: string; reason: string }>;
  logged?: Array<{ field: string; logId: number }>;
  applied?: Array<{ field: string; value: any; evidence?: string }>;
  /** 这次新记下的长期记忆（同样是"用户没要求过的后台写入"，来源标为 AI） */
  memories?: Array<{ id: number; kind: string; content: string }>;
  memoriesSkipped?: Array<{ content: string; reason: string }>;
}

/** 一次回合后抽取的结果，供界面显示"AI 记住了什么"并可撤销 */
export interface RememberedNote {
  profileFields: Array<{ field: string; value: any; logId: number }>;
  memories: Array<{ id: number; kind: string; content: string }>;
  error?: string;
}

export async function extractFromTurn(
  userMessage: string,
  alreadyWritten?: boolean,
): Promise<ExtractResult | null> {
  try {
    const res = await fetch(`${API_BASE}/ai/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ userMessage, alreadyWritten }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data ?? null;
  } catch {
    return null;   // 抽取失败与用户无关，静默
  }
}

/**
 * 回合后抽取 + 把结果整理成界面要的"AI 记住了"清单。
 *
 * 两道零成本闸门在后端（顾问本轮已落盘 / 未命中自述正则），所以这里可以放心调用：
 * 闲聊会直接返回 skipped，不会花任何模型调用。
 */
export async function runPostTurnExtraction(
  userMessage: string,
  alreadyWritten?: boolean,
): Promise<RememberedNote | null> {
  const r = await extractFromTurn(userMessage, alreadyWritten);
  if (!r || r.skipped) return null;

  const logIdOf = (field: string) => (r.logged || []).find((l) => l.field === field)?.logId;
  const profileFields = (r.applied || [])
    .map((a) => ({ field: a.field, value: a.value, logId: logIdOf(a.field) }))
    .filter((x): x is { field: string; value: any; logId: number } => typeof x.logId === 'number');
  const memories = (r.memories || []).map((m) => ({ id: m.id, kind: m.kind, content: m.content }));

  if (profileFields.length === 0 && memories.length === 0) return null;
  return { profileFields, memories };
}

/** 撤销这一批"AI 记住的"：画像字段走日志还原，记忆走墓碑删除 */
export async function undoRememberedNote(note: RememberedNote): Promise<void> {
  for (const f of note.profileFields) await undoProfileWrite(f.logId);
  for (const m of note.memories) await rejectMemory(m.id);
}

// ---------------------------------------------------------------- 长期记忆管理

export interface MemoryItem {
  id: number;
  kind: string;
  content: string;
  evidence: string | null;
  source: string;
  status: string;
  origin: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export async function fetchMemories(
  status: 'active' | 'rejected' | 'all' = 'active',
  limit = 100,
): Promise<MemoryItem[]> {
  const res = await fetch(`${API_BASE}/ai/memories?status=${status}&limit=${limit}`, { headers: authHeader() });
  if (!res.ok) throw new Error('获取记忆失败');
  const data = await res.json();
  return data?.data ?? [];
}

/** 删除一条记忆（后端写墓碑：不再注入，也不会被自动记回来） */
export async function rejectMemory(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/ai/memories/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function restoreMemory(id: number): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/ai/memories/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.data?.restored;
  } catch {
    return false;
  }
}

export interface ProfileWriteLogItem {
  id: number;
  field: string;
  prevValue: any;
  nextValue: any;
  source: string;
  via: string | null;
  evidence: string | null;
  origin: string;
  undoneAt: string | null;
  createdAt: string;
}

export async function fetchProfileWriteLog(limit = 30): Promise<ProfileWriteLogItem[]> {
  const res = await fetch(`${API_BASE}/ai/profile/log?limit=${limit}`, { headers: authHeader() });
  if (!res.ok) throw new Error('获取画像改动历史失败');
  const data = await res.json();
  return data?.data ?? [];
}

/** 撤销一次画像写入，返回撤销后的完整画像 */
export async function undoProfileWrite(logId: number): Promise<UserProfile | null> {
  const res = await fetch(`${API_BASE}/ai/profile/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ logId }),
  });
  if (!res.ok) throw new Error('撤销失败');
  const data = await res.json();
  return data?.data?.profile ?? null;
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
