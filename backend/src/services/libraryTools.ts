/**
 * 书库工具函数 — 供 AI Agent 动态调用
 *
 * 设计原则：
 * - 常驻上下文只传"概览"（分类统计 + 在读书详情）
 * - AI 需要具体书籍信息时，通过 tool call 动态获取
 * - 每个工具的返回值都经过裁剪，只包含 AI 需要的字段
 * - AI 可以查询用户画像，实现真正的个性化
 * - 支持写操作（update_book_status），AI 可直接更新阅读状态
 *
 * v2 优化：
 * - 增加 update_book_status 写工具
 * - 增加工具结果 LRU 缓存辅助函数
 *
 * v3 优化：
 * - 整合 Exa Web 搜索工具（web_search / web_fetch）
 * - getAllTools() 条件性合并书库工具 + Web 工具
 * - executeAllTools() 统一异步执行器（书库工具同步，Web 工具异步）
 */

import { Book, BookStatus, BookLevel } from '../types';
import { UserProfile } from '../types';
import {
  WEB_TOOLS,
  executeWebTool,
  isWebTool,
  describeWebToolCall,
  isWebSearchEnabled,
  clearWebCache,
} from './webSearchService';

// ============================================================================
// 工具结果缓存 — 同一轮对话中避免重复查询
// ============================================================================

/** LRU 缓存：缓存工具调用结果，key = toolName:JSON.stringify(args) */
const toolResultCache = new Map<string, string>();
const TOOL_CACHE_MAX = 50;

/** 生成缓存 key */
function getCacheKey(toolName: string, args: Record<string, any>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

/** 查询缓存 */
export function getCachedToolResult(toolName: string, args: Record<string, any>): string | undefined {
  const key = getCacheKey(toolName, args);
  const result = toolResultCache.get(key);
  if (result !== undefined) {
    // LRU: 移到末尾（最近使用）
    toolResultCache.delete(key);
    toolResultCache.set(key, result);
  }
  return result;
}

/** 写入缓存 */
export function setCachedToolResult(toolName: string, args: Record<string, any>, result: string): void {
  const key = getCacheKey(toolName, args);
  if (toolResultCache.size >= TOOL_CACHE_MAX) {
    // 删除最老的条目
    const firstKey = toolResultCache.keys().next().value;
    if (firstKey) toolResultCache.delete(firstKey);
  }
  toolResultCache.set(key, result);
}

/** 清空缓存（每次新请求时调用，同时清理 Web 缓存） */
export function clearToolCache(): void {
  toolResultCache.clear();
  clearWebCache();
}

/** 判断是否为写工具（写工具不缓存） */
function isWriteTool(toolName: string): boolean {
  return toolName === 'update_book_status';
}

// ============================================================================
// 工具定义（OpenAI function calling 格式）
// ============================================================================

export const LIBRARY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_library',
      description: '在用户书库中搜索书籍。支持按关键词、分类、标签、状态、难度筛选。返回书籍基本信息（不含AI解读详情）。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '搜索关键词（匹配书名、作者或标签）' },
          category: { type: 'string', description: '分类名称' },
          tag: { type: 'string', description: '标签名称（精确匹配书库中的标签）' },
          status: { type: 'string', enum: ['unread', 'reading', 'finished'], description: '阅读状态' },
          level: { type: 'string', enum: ['Basic', 'Advanced', 'Expert'], description: '难度等级' },
          limit: { type: 'number', description: '返回数量上限，默认15', default: 15 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_book_details',
      description: '获取指定书籍的详细信息，包括AI解读(summary/advice/keyChapters)、豆瓣摘要、豆瓣标签、评分、阅读进度、用户标签等。当需要深入了解某本书时使用。',
      parameters: {
        type: 'object',
        properties: {
          bookIds: {
            type: 'array',
            items: { type: 'string' },
            description: '书籍ID列表（最多10个）',
          },
        },
        required: ['bookIds'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_category_stats',
      description: '获取某个分类下的书籍列表和统计信息，包括阅读进度分布、难度分布、评分情况。当需要了解某个领域的阅读情况时使用。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '分类名称' },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_reading_history',
      description: '获取最近已读完的书籍列表（含完成日期、评分、AI摘要、豆瓣评分）。用于分析用户阅读历史和偏好。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '返回数量，默认10', default: 10 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_user_profile',
      description: '获取用户画像信息，包括自评阅读水平、阅读目标、偏好分类、每日阅读时间、AI历史分析（推断水平、阅读模式、知识盲区、建议方向）。当需要了解用户背景以提供个性化建议时使用。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_book_status',
      description: '更新书籍的阅读状态和进度（写操作）。当用户表示已读完、开始阅读或想更新进度时使用。更新后前端会同步显示新状态。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '要更新的书籍ID' },
          status: { type: 'string', enum: ['unread', 'reading', 'finished'], description: '新的阅读状态' },
          currentPage: { type: 'number', description: '当前阅读页码（可选）' },
          rating: { type: 'number', description: '用户评分 1-5（可选，读完时使用）' },
        },
        required: ['bookId', 'status'],
      },
    },
  },
];

// ============================================================================
// 工具执行器
// ============================================================================

/** 书籍更新回调 — 用于通知前端 */
export type BookUpdateCallback = (bookId: string, updates: Partial<Book>) => void;

// ============================================================================
// 统一工具列表 — 条件性合并书库工具 + Web 工具
// ============================================================================

/**
 * 获取所有可用工具（书库工具 + 条件性 Web 工具）
 * 当 EXA_API_KEY 未配置时，只返回书库工具
 */
export function getAllTools(): any[] {
  if (isWebSearchEnabled()) {
    return [...LIBRARY_TOOLS, ...WEB_TOOLS];
  }
  return LIBRARY_TOOLS;
}

/**
 * 统一工具执行器（异步）— 同时支持书库工具（同步）和 Web 工具（异步）
 * 
 * @param toolName 工具名称
 * @param args 工具参数
 * @param library 书库数据
 * @param userProfile 用户画像
 * @param onBookUpdate 书籍更新回调
 * @returns JSON 格式的工具结果字符串
 */
export async function executeAllTools(
  toolName: string,
  args: Record<string, any>,
  library: Book[],
  userProfile?: UserProfile,
  onBookUpdate?: BookUpdateCallback,
): Promise<string> {
  // Web 工具走异步路径
  if (isWebTool(toolName)) {
    return executeWebTool(toolName, args);
  }
  // 书库工具走同步路径
  return executeLibraryTool(toolName, args, library, userProfile, onBookUpdate);
}

/**
 * 将书库工具名 + 参数转换为人类可读的描述
 */
function describeToolCall(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'search_library': {
      const parts: string[] = [];
      if (args.keyword) parts.push(`关键词「${args.keyword}」`);
      if (args.category) parts.push(`分类「${args.category}」`);
      if (args.tag) parts.push(`标签「${args.tag}」`);
      if (args.status) {
        const statusMap: Record<string, string> = { reading: '在读', finished: '已读', unread: '未读' };
        parts.push(statusMap[args.status] || args.status);
      }
      if (args.level) {
        const levelMap: Record<string, string> = { Basic: '入门', Advanced: '进阶', Expert: '专家' };
        parts.push(levelMap[args.level] || args.level);
      }
      return parts.length > 0 ? `搜索书库（${parts.join('、')}）` : '搜索书库';
    }
    case 'get_book_details':
      return `获取书籍详情${args.bookIds ? `（${args.bookIds.length} 本）` : ''}`;
    case 'get_category_stats':
      return args.category ? `查看「${args.category}」分类统计` : '查看分类统计';
    case 'get_reading_history':
      return '查看阅读历史';
    case 'get_user_profile':
      return '查看用户画像';
    case 'update_book_status': {
      const statusMap: Record<string, string> = { reading: '开始阅读', finished: '读完', unread: '重置为未读' };
      return `更新书籍状态${args.status ? `（${statusMap[args.status] || args.status}）` : ''}`;
    }
    default:
      return toolName;
  }
}

/**
 * 统一工具调用描述 — 用于 onToolCall 回调
 */
export function describeToolCallUnified(toolName: string, args: Record<string, any>): string {
  if (isWebTool(toolName)) {
    return describeWebToolCall(toolName, args);
  }
  return describeToolCall(toolName, args);
}

export function executeLibraryTool(
  toolName: string,
  args: Record<string, any>,
  library: Book[],
  userProfile?: UserProfile,
  onBookUpdate?: BookUpdateCallback,
): string {
  try {
    // 写工具不缓存，直接执行
    if (!isWriteTool(toolName)) {
      const cached = getCachedToolResult(toolName, args);
      if (cached !== undefined) {
        return cached;
      }
    }

    let result: string;
    switch (toolName) {
      case 'search_library':
        result = JSON.stringify(searchLibrary(args, library));
        break;
      case 'get_book_details':
        result = JSON.stringify(getBookDetails(args, library));
        break;
      case 'get_category_stats':
        result = JSON.stringify(getCategoryStats(args, library));
        break;
      case 'get_reading_history':
        result = JSON.stringify(getReadingHistory(args, library));
        break;
      case 'get_user_profile':
        result = JSON.stringify(getUserProfile(userProfile));
        break;
      case 'update_book_status':
        result = JSON.stringify(updateBookStatus(args, library, onBookUpdate));
        break;
      default:
        result = JSON.stringify({ error: `未知工具: ${toolName}` });
    }

    // 缓存读操作结果
    if (!isWriteTool(toolName)) {
      setCachedToolResult(toolName, args, result);
    }

    return result;
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}

// ============================================================================
// 内部实现
// ============================================================================

interface BookBrief {
  id: string;
  title: string;
  author: string;
  category: string;
  subcategory: string;
  level: string;
  status: string;
  rating?: number;
  doubanRating?: number;
  progress?: number;
  tags?: string[];
}

function toBrief(book: Book): BookBrief {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    category: book.category,
    subcategory: book.subcategory,
    level: book.level,
    status: book.status,
    rating: book.rating,
    doubanRating: book.doubanData?.rating_score,
    progress: book.userData?.progressPercentage,
    tags: book.tags,
  };
}

function searchLibrary(args: Record<string, any>, library: Book[]): { total: number; books: BookBrief[] } {
  let result = [...library];

  if (args.keyword) {
    const kw = args.keyword.toLowerCase();
    result = result.filter(b =>
      b.title.toLowerCase().includes(kw) ||
      b.author.toLowerCase().includes(kw) ||
      (b.tags && b.tags.some(t => t.toLowerCase().includes(kw)))
    );
  }
  if (args.category) {
    result = result.filter(b => b.category === args.category || b.subcategory === args.category);
  }
  if (args.tag) {
    const tag = args.tag.toLowerCase();
    result = result.filter(b =>
      (b.tags && b.tags.some(t => t.toLowerCase() === tag)) ||
      (b.doubanData?.tags && b.doubanData.tags.some(t => t.name.toLowerCase() === tag))
    );
  }
  if (args.status) {
    result = result.filter(b => b.status === args.status);
  }
  if (args.level) {
    result = result.filter(b => b.level === args.level);
  }

  const limit = args.limit || 15;
  const total = result.length;
  result = result.slice(0, limit);

  return { total, books: result.map(toBrief) };
}

function getBookDetails(args: Record<string, any>, library: Book[]): any[] {
  const ids: string[] = args.bookIds || [];
  const books = library.filter(b => ids.includes(b.id)).slice(0, 10);

  return books.map(b => ({
    id: b.id,
    title: b.title,
    author: b.author,
    publisher: b.publisher,
    category: b.category,
    subcategory: b.subcategory,
    level: b.level,
    status: b.status,
    tags: b.tags,
    rating: b.rating,
    doubanRating: b.doubanData?.rating_score,
    doubanRatingCount: b.doubanData?.rating_count,
    aiInsight: b.aiInsight ? {
      summary: b.aiInsight.summary,
      advice: b.aiInsight.advice,
      keyChapters: b.aiInsight.keyChapters,
    } : undefined,
    doubanSummary: b.doubanData?.summary?.slice(0, 500),
    doubanTags: b.doubanData?.tags?.slice(0, 10).map(t => t.name),
    doubanPublisher: b.doubanData?.publisher,
    doubanPubdate: b.doubanData?.pubdate,
    doubanPages: b.doubanData?.pages,
    readingProgress: b.userData ? {
      currentPage: b.userData.currentPage,
      totalPages: b.userData.totalPages,
      percentage: b.userData.progressPercentage,
      startDate: b.userData.startDate,
      completionDate: b.userData.completionDate,
    } : undefined,
  }));
}

function getCategoryStats(args: Record<string, any>, library: Book[]): any {
  const category = args.category;
  const books = library.filter(b => b.category === category || b.subcategory === category);

  // 计算平均评分
  const ratedBooks = books.filter(b => b.rating);
  const avgRating = ratedBooks.length > 0
    ? ratedBooks.reduce((sum, b) => sum + (b.rating || 0), 0) / ratedBooks.length
    : 0;

  const stats = {
    category,
    totalBooks: books.length,
    reading: books.filter(b => b.status === BookStatus.READING).length,
    finished: books.filter(b => b.status === BookStatus.FINISHED).length,
    unread: books.filter(b => b.status === BookStatus.UNREAD).length,
    avgRating: avgRating > 0 ? avgRating.toFixed(1) : null,
    levelDistribution: {
      [BookLevel.BASIC]: books.filter(b => b.level === BookLevel.BASIC).length,
      [BookLevel.ADVANCED]: books.filter(b => b.level === BookLevel.ADVANCED).length,
      [BookLevel.EXPERT]: books.filter(b => b.level === BookLevel.EXPERT).length,
    },
    books: books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      level: b.level,
      status: b.status,
      progress: b.userData?.progressPercentage,
      rating: b.rating,
      doubanRating: b.doubanData?.rating_score,
    })),
  };

  return stats;
}

function getReadingHistory(args: Record<string, any>, library: Book[]): any[] {
  const limit = args.limit || 10;
  const finished = library
    .filter(b => b.status === BookStatus.FINISHED)
    .sort((a, b) => {
      const dateA = a.userData?.completionDate || '';
      const dateB = b.userData?.completionDate || '';
      return dateB.localeCompare(dateA);
    })
    .slice(0, limit);

  return finished.map(b => ({
    id: b.id,
    title: b.title,
    author: b.author,
    category: b.category,
    subcategory: b.subcategory,
    level: b.level,
    rating: b.rating,
    doubanRating: b.doubanData?.rating_score,
    completionDate: b.userData?.completionDate,
    aiSummary: b.aiInsight?.summary?.slice(0, 100),
  }));
}

function getUserProfile(userProfile?: UserProfile): any {
  if (!userProfile) {
    return { error: '用户尚未设置画像信息' };
  }

  const levelMap: Record<string, string> = {
    beginner: '初学者', intermediate: '中级读者', advanced: '高级读者', expert: '专家级',
  };

  return {
    readingLevel: userProfile.readingLevel,
    readingLevelLabel: levelMap[userProfile.readingLevel] || userProfile.readingLevel,
    nickname: userProfile.nickname,
    readingGoal: userProfile.readingGoal,
    preferredCategories: userProfile.preferredCategories,
    dailyReadingTime: userProfile.dailyReadingTime,
    aiAnalysis: userProfile.aiAnalysis ? {
      inferredLevel: userProfile.aiAnalysis.inferredLevel,
      readingPattern: userProfile.aiAnalysis.readingPattern,
      blindSpots: userProfile.aiAnalysis.blindSpots,
      recommendedFocus: userProfile.aiAnalysis.recommendedFocus,
      lastUpdated: userProfile.aiAnalysis.lastUpdated,
    } : undefined,
  };
}

// ============================================================================
// 写工具实现 — update_book_status
// ============================================================================

function updateBookStatus(
  args: Record<string, any>,
  library: Book[],
  onBookUpdate?: BookUpdateCallback,
): { success: boolean; message: string; book?: any } {
  const { bookId, status, currentPage, rating } = args;
  const book = library.find(b => b.id === bookId);
  if (!book) {
    return { success: false, message: `未找到书籍ID: ${bookId}` };
  }

  const updates: Partial<Book> = {};

  // 更新状态
  if (status && ['unread', 'reading', 'finished'].includes(status)) {
    updates.status = status as BookStatus;
    book.status = status as BookStatus;
  }

  // 更新页码
  if (typeof currentPage === 'number' && currentPage >= 0) {
    if (!book.userData) {
      book.userData = {
        totalPages: book.doubanData?.pages || 0,
        currentPage,
        progressPercentage: 0,
      };
    }
    book.userData.currentPage = currentPage;
    if (book.userData.totalPages > 0) {
      book.userData.progressPercentage = Math.min(100, (currentPage / book.userData.totalPages) * 100);
    }
    updates.userData = book.userData;
  }

  // 更新评分
  if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
    book.rating = rating;
    updates.rating = rating;
  }

  // 完成日期
  if (status === 'finished' && !book.userData?.completionDate) {
    const today = new Date().toISOString().split('T')[0];
    if (!book.userData) {
      book.userData = { totalPages: 0, currentPage: 0, progressPercentage: 100 };
    }
    book.userData.completionDate = today;
    updates.userData = book.userData;
  }

  // 开始日期
  if (status === 'reading' && !book.userData?.startDate) {
    const today = new Date().toISOString().split('T')[0];
    if (!book.userData) {
      book.userData = { totalPages: 0, currentPage: 0, progressPercentage: 0 };
    }
    book.userData.startDate = today;
    updates.userData = book.userData;
  }

  // 通知前端
  if (onBookUpdate) {
    onBookUpdate(bookId, updates);
  }

  return {
    success: true,
    message: `已更新《${book.title}》的状态为: ${status}`,
    book: toBrief(book),
  };
}

// ============================================================================
// 库概览生成 — 常驻上下文（紧凑格式）
// ============================================================================

export function buildLibraryOverview(library: Book[]): string {
  const total = library.length;
  const reading = library.filter(b => b.status === BookStatus.READING);
  const finished = library.filter(b => b.status === BookStatus.FINISHED);
  const unread = library.filter(b => b.status === BookStatus.UNREAD);

  // 分类统计
  const catMap: Record<string, { total: number; reading: number; finished: number; unread: number }> = {};
  for (const b of library) {
    if (!catMap[b.category]) {
      catMap[b.category] = { total: 0, reading: 0, finished: 0, unread: 0 };
    }
    catMap[b.category].total++;
    if (b.status === BookStatus.READING) catMap[b.category].reading++;
    else if (b.status === BookStatus.FINISHED) catMap[b.category].finished++;
    else catMap[b.category].unread++;
  }

  const catStats = Object.entries(catMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, s]) => `${cat}(${s.total}本: 在读${s.reading},已读${s.finished},未读${s.unread})`)
    .join('、');

  let overview = `【书库概览】共 ${total} 本（在读 ${reading.length}，已读 ${finished.length}，未读 ${unread.length}）\n`;
  overview += `【分类分布】${catStats}\n`;

  // 难度分布
  const levelStats = {
    [BookLevel.BASIC]: library.filter(b => b.level === BookLevel.BASIC).length,
    [BookLevel.ADVANCED]: library.filter(b => b.level === BookLevel.ADVANCED).length,
    [BookLevel.EXPERT]: library.filter(b => b.level === BookLevel.EXPERT).length,
  };
  overview += `【难度分布】入门${levelStats[BookLevel.BASIC]}、进阶${levelStats[BookLevel.ADVANCED]}、专家${levelStats[BookLevel.EXPERT]}\n`;

  // 评分统计
  const ratedBooks = library.filter(b => b.rating);
  if (ratedBooks.length > 0) {
    const avgRating = ratedBooks.reduce((sum, b) => sum + (b.rating || 0), 0) / ratedBooks.length;
    overview += `【评分】已评${ratedBooks.length}本，平均${avgRating.toFixed(1)}分\n`;
  }

  // 在读书籍详情（通常只有几本，直接传）
  if (reading.length > 0) {
    overview += `\n【在读书籍】\n`;
    for (const b of reading) {
      overview += `[${b.id}] 《${b.title}》- ${b.author} [${b.category}/${b.subcategory}] (${b.level}, 进度${Math.round(b.userData?.progressPercentage || 0)}%)\n`;
      if (b.aiInsight?.summary) {
        overview += `  摘要: ${b.aiInsight.summary.slice(0, 80)}...\n`;
      }
    }
  }

  // 最近读完的5本（索引，不含详情）
  const recentFinished = finished
    .sort((a, b) => (b.userData?.completionDate || '').localeCompare(a.userData?.completionDate || ''))
    .slice(0, 5);
  if (recentFinished.length > 0) {
    overview += `\n【最近读完】\n`;
    for (const b of recentFinished) {
      const rating = b.rating ? ` ${b.rating}★` : '';
      overview += `[${b.id}] 《${b.title}》- ${b.author} [${b.category}] (${b.level}${rating})\n`;
    }
  }

  // 所有书籍索引（紧凑格式，供 AI 按需查询）
  if (library.length > 0 && library.length <= 100) {
    overview += `\n【书库索引】\n`;
    for (const b of library) {
      const statusIcon = b.status === BookStatus.READING ? '📖' : b.status === BookStatus.FINISHED ? '✓' : '○';
      overview += `[${b.id}] ${statusIcon} 《${b.title}》- ${b.author} [${b.category}/${b.subcategory}] (${b.level})\n`;
    }
  }

  overview += `\n提示：使用工具可以搜索书库（含标签搜索）、获取书籍详情（含豆瓣标签和评分）、查看分类统计、查看阅读历史、查看用户画像。`;

  return overview;
}
