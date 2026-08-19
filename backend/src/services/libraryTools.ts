/**
 * 书库工具函数 — 供 AI Agent 动态调用
 *
 * 设计原则：
 * - 常驻上下文只传"概览"（分类统计 + 在读书详情 + 阅读品味画像）
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
 *
 * v4 优化（深度个性化）：
 * - 新增 get_reading_taste_profile 工具 — 自动分析阅读品味画像
 * - 新增 get_reading_gaps 工具 — 识别知识体系中的缺口
 * - 增强 buildLibraryOverview — 包含阅读品味画像和轨迹分析
 * - 增强工具描述，引导 AI 优先使用分析型工具
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
      name: 'get_reading_taste_profile',
      description: '获取用户阅读品味画像。自动分析书库数据，推断用户的知识结构、阅读偏好（理论vs实践、入门vs挑战）、阅读节奏、潜在兴趣。推荐时建议优先使用此工具了解用户的阅读品味，以便给出更精准的个性化推荐。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_reading_gaps',
      description: '获取用户知识缺口分析。自动识别用户知识体系中的薄弱环节：深度缺口（只有入门缺少进阶）、广度缺口（只读一个领域）、应用缺口（理论多实践少）、时效缺口（旧书多新书少）。推荐时建议使用此工具发现用户的知识盲区，给出有突破价值的推荐。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_reading_notes',
      description: '获取用户在书籍上记录的阅读笔记、思考、感悟或问题。当需要深入了解用户对某本书的思考以提供更个性化的建议时使用。',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: '指定书籍ID（可选，不传则返回所有有笔记的书籍概要）' },
        },
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
    case 'get_reading_taste_profile':
      return '分析阅读品味画像';
    case 'get_reading_gaps':
      return '分析知识缺口';
    case 'get_reading_notes':
      return args.bookId ? `查看阅读笔记` : '查看所有阅读笔记';
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
      case 'get_reading_taste_profile':
        result = JSON.stringify(getReadingTasteProfile(library));
        break;
      case 'get_reading_gaps':
        result = JSON.stringify(getReadingGaps(library));
        break;
      case 'get_reading_notes':
        result = JSON.stringify(getReadingNotes(args, library));
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
    notes: b.notes,
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
// v4 新增：阅读品味画像分析
// ============================================================================

/**
 * 自动分析用户阅读品味画像
 *
 * 从书库数据中推断：
 * 1. 知识结构 — 在哪些领域有积累，深度如何
 * 2. 阅读偏好 — 偏理论还是实践，偏入门还是挑战
 * 3. 阅读节奏 — 快速浏览型还是深度精读型
 * 4. 潜在兴趣 — 从阅读轨迹推断未明说的兴趣
 * 5. 阅读轨迹 — 起点 → 当前 → 方向
 */
function getReadingTasteProfile(library: Book[]): any {
  if (!library || library.length === 0) {
    return { error: '书库为空，无法分析阅读品味' };
  }

  const total = library.length;
  const reading = library.filter(b => b.status === BookStatus.READING);
  const finished = library.filter(b => b.status === BookStatus.FINISHED);
  const unread = library.filter(b => b.status === BookStatus.UNREAD);

  // === 1. 知识结构分析 ===
  const catMap: Record<string, { total: number; finished: number; reading: number; unread: number; levels: Record<string, number> }> = {};
  for (const b of library) {
    if (!catMap[b.category]) {
      catMap[b.category] = { total: 0, finished: 0, reading: 0, unread: 0, levels: { Basic: 0, Advanced: 0, Expert: 0 } };
    }
    catMap[b.category].total++;
    catMap[b.category].levels[b.level]++;
    if (b.status === BookStatus.READING) catMap[b.category].reading++;
    else if (b.status === BookStatus.FINISHED) catMap[b.category].finished++;
    else catMap[b.category].unread++;
  }

  // 按藏书量排序分类
  const topCategories = Object.entries(catMap)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)
    .map(([cat, s]) => ({
      category: cat,
      total: s.total,
      finished: s.finished,
      reading: s.reading,
      unread: s.unread,
      dominantLevel: s.levels.Basic > s.levels.Advanced && s.levels.Basic > s.levels.Expert ? '入门为主'
        : s.levels.Expert > s.levels.Advanced ? '专家为主'
        : s.levels.Advanced > 0 ? '进阶为主' : '未知',
    }));

  // === 2. 阅读偏好分析 ===
  const levelDist = {
    Basic: library.filter(b => b.level === BookLevel.BASIC).length,
    Advanced: library.filter(b => b.level === BookLevel.ADVANCED).length,
    Expert: library.filter(b => b.level === BookLevel.EXPERT).length,
  };

  const preferenceProfile = {
    difficultyPreference: levelDist.Basic > levelDist.Advanced + levelDist.Expert ? '偏入门（可能停留在舒适区）'
      : levelDist.Expert > levelDist.Basic + levelDist.Advanced ? '偏专家（喜欢挑战）'
      : levelDist.Advanced > levelDist.Basic && levelDist.Advanced > levelDist.Expert ? '偏进阶（稳步成长）'
      : '均衡分布',
    levelDistribution: levelDist,
  };

  // === 3. 阅读节奏分析 ===
  const readingPace = {
    totalBooks: total,
    finishedRate: total > 0 ? (finished.length / total * 100).toFixed(0) + '%' : '0%',
    avgProgress: reading.length > 0
      ? Math.round(reading.reduce((sum, b) => sum + (b.userData?.progressPercentage || 0), 0) / reading.length) + '%'
      : null,
    stuckBooks: reading.filter(b => (b.userData?.progressPercentage || 0) > 0 && (b.userData?.progressPercentage || 0) < 30).length,
    // 计算平均阅读周期（从开始日期到完成日期）
    avgReadingDays: (() => {
      const withDates = finished.filter(b => b.userData?.startDate && b.userData?.completionDate);
      if (withDates.length === 0) return null;
      const days = withDates.map(b => {
        const start = new Date(b.userData!.startDate!).getTime();
        const end = new Date(b.userData!.completionDate!).getTime();
        return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
      });
      return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    })(),
  };

  // === 4. 阅读轨迹分析 ===
  const trajectory = {
    startingPoint: (() => {
      // 最早读完的书
      const earliest = finished
        .filter(b => b.userData?.completionDate)
        .sort((a, b) => (a.userData!.completionDate!).localeCompare(b.userData!.completionDate!));
      return earliest.length > 0
        ? { title: earliest[0].title, category: earliest[0].category, date: earliest[0].userData!.completionDate }
        : null;
    })(),
    currentFocus: reading.length > 0
      ? reading.map(b => ({ title: b.title, category: b.category, progress: Math.round(b.userData?.progressPercentage || 0) }))
      : null,
    recentFinished: finished
      .filter(b => b.userData?.completionDate)
      .sort((a, b) => (b.userData!.completionDate!).localeCompare(a.userData!.completionDate!))
      .slice(0, 3)
      .map(b => ({ title: b.title, category: b.category, date: b.userData!.completionDate })),
    // 是否频繁切换分类
    categoryHopping: topCategories.length > 5 && topCategories.every(c => c.total <= 3)
      ? '频繁切换多个分类，可能在广泛探索阶段'
      : topCategories.length <= 3 && topCategories[0]?.total > total * 0.5
      ? '高度集中于单一领域'
      : '有主次分类，阅读较为聚焦',
  };

  // === 5. 潜在兴趣推断 ===
  // 从子分类和标签中提取隐性兴趣
  const subcatFreq: Record<string, number> = {};
  for (const b of library) {
    const key = `${b.category}/${b.subcategory}`;
    subcatFreq[key] = (subcatFreq[key] || 0) + 1;
  }
  const topSubcategories = Object.entries(subcatFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sub, count]) => ({ subcategory: sub, count }));

  // 作者频率（偏爱的作者）
  const authorFreq: Record<string, number> = {};
  for (const b of library) {
    authorFreq[b.author] = (authorFreq[b.author] || 0) + 1;
  }
  const topAuthors = Object.entries(authorFreq)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([author, count]) => ({ author, count }));

  // === 6. 评分倾向 ===
  const ratedBooks = library.filter(b => b.rating);
  const ratingTendency = ratedBooks.length > 0
    ? {
        avgRating: (ratedBooks.reduce((sum, b) => sum + (b.rating || 0), 0) / ratedBooks.length).toFixed(1),
        ratingCount: ratedBooks.length,
        tendency: (() => {
          const avg = ratedBooks.reduce((sum, b) => sum + (b.rating || 0), 0) / ratedBooks.length;
          if (avg >= 4.2) return '评价偏高，可能比较宽容或只选好书';
          if (avg < 3.2) return '评价偏严，对书籍质量要求高';
          return '评价适中';
        })(),
      }
    : null;

  // === 7. 阅读人格推断（深度个性化） ===
  const readingPersonality = (() => {
    const finishRate = total > 0 ? finished.length / total : 0;
    const avgBooksPerCategory = Object.keys(catMap).length > 0 ? total / Object.keys(catMap).length : 0;

    // 完成型 vs 探索型
    let readerType: string;
    if (finishRate >= 0.7) readerType = '完成型读者（读完率高，追求闭环）';
    else if (finishRate < 0.3 && total > 10) readerType = '探索型读者（广泛涉猎，不追求读完）';
    else readerType = '平衡型读者（既探索也完成）';

    // 深度型 vs 广度型
    let depthBreadth: string;
    if (Object.keys(catMap).length <= 2 && avgBooksPerCategory >= 5) depthBreadth = '深度型（聚焦少数领域，深入钻研）';
    else if (Object.keys(catMap).length >= 6 && avgBooksPerCategory < 3) depthBreadth = '广度型（多领域探索，知识面宽）';
    else depthBreadth = '均衡型（有主次领域，兼顾深度与广度）';

    // 学习风格推断
    const theoryKeywords = ['原理', '导论', '理论', '基础', '概论', '思想', '哲学'];
    const practiceKeywords = ['实战', '实践', '项目', '手册', '案例', '动手', 'cookbook'];
    const theoryCount = library.filter(b =>
      theoryKeywords.some(kw => b.title.toLowerCase().includes(kw) || b.subcategory.toLowerCase().includes(kw))
    ).length;
    const practiceCount = library.filter(b =>
      practiceKeywords.some(kw => b.title.toLowerCase().includes(kw) || b.subcategory.toLowerCase().includes(kw))
    ).length;
    let learningStyle: string;
    if (theoryCount > practiceCount * 1.5) learningStyle = '理论优先型（先理解原理再实践）';
    else if (practiceCount > theoryCount * 1.5) learningStyle = '实践驱动型（边做边学，在实战中理解）';
    else learningStyle = '理实交融型（理论与实践并重）';

    // 阅读连贯性推断
    const readingDates = finished
      .map(b => b.userData?.completionDate)
      .filter(Boolean)
      .sort() as string[];
    let consistency: string;
    if (readingDates.length >= 3) {
      const firstDate = new Date(readingDates[0]);
      const lastDate = new Date(readingDates[readingDates.length - 1]);
      const totalDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)));
      const booksPerMonth = (readingDates.length / totalDays) * 30;
      if (booksPerMonth >= 3) consistency = `高频阅读者（约${booksPerMonth.toFixed(1)}本/月）`;
      else if (booksPerMonth >= 1) consistency = `稳定阅读者（约${booksPerMonth.toFixed(1)}本/月）`;
      else consistency = `间歇阅读者（约${booksPerMonth.toFixed(1)}本/月，可能集中突击）`;
    } else {
      consistency = '阅读数据不足，无法判断节奏';
    }

    // 难度进化路径
    let difficultyEvolution: string;
    if (levelDist.Basic > 0 && levelDist.Advanced === 0 && levelDist.Expert === 0) {
      difficultyEvolution = '入门阶段（全为入门书，尚未向高难度进阶）';
    } else if (levelDist.Advanced > 0 && levelDist.Expert === 0) {
      difficultyEvolution = '成长阶段（已从入门进阶到进阶级别）';
    } else if (levelDist.Expert > 0) {
      difficultyEvolution = '高阶阶段（已涉猎专家级内容，追求深度）';
    } else {
      difficultyEvolution = '未知';
    }

    return { readerType, depthBreadth, learningStyle, consistency, difficultyEvolution };
  })();

  return {
    knowledgeStructure: {
      totalCategories: Object.keys(catMap).length,
      topCategories,
      topSubcategories,
      topAuthors,
    },
    preferenceProfile,
    readingPace,
    trajectory,
    ratingTendency,
    readingPersonality,
    summary: `藏书${total}本（在读${reading.length}、已读${finished.length}、未读${unread.length}），` +
      `主要领域：${topCategories.slice(0, 3).map(c => c.category).join('、')}。` +
      `难度偏好：${preferenceProfile.difficultyPreference}。` +
      `阅读节奏：完成率${readingPace.finishedRate}，` +
      (readingPace.stuckBooks > 0 ? `有${readingPace.stuckBooks}本在读但进度停滞。` : '') +
      (trajectory.categoryHopping ? trajectory.categoryHopping : '') +
      `\n阅读人格：${readingPersonality.readerType}，${readingPersonality.depthBreadth}，${readingPersonality.learningStyle}。` +
      `${readingPersonality.consistency}。难度进化：${readingPersonality.difficultyEvolution}。`,
  };
}

// ============================================================================
// v4 新增：知识缺口分析
// ============================================================================

/**
 * 识别用户知识体系中的缺口
 *
 * 缺口类型：
 * 1. 深度缺口 — 同一分类只有入门书，缺少进阶
 * 2. 广度缺口 — 只读一个领域，缺少跨学科
 * 3. 应用缺口 — 理论多实践少
 * 4. 时效缺口 — 旧书多新书少
 * 5. 进度缺口 — 在读但长期停滞的书
 */
function getReadingGaps(library: Book[]): any {
  if (!library || library.length === 0) {
    return { error: '书库为空，无法分析知识缺口' };
  }

  const gaps: any[] = [];

  // === 1. 深度缺口检测 ===
  const catLevelMap: Record<string, { Basic: number; Advanced: number; Expert: number; total: number }> = {};
  for (const b of library) {
    if (!catLevelMap[b.category]) {
      catLevelMap[b.category] = { Basic: 0, Advanced: 0, Expert: 0, total: 0 };
    }
    catLevelMap[b.category][b.level]++;
    catLevelMap[b.category].total++;
  }

  for (const [cat, levels] of Object.entries(catLevelMap)) {
    if (levels.total >= 3 && levels.Basic > 0 && levels.Advanced === 0 && levels.Expert === 0) {
      gaps.push({
        type: 'depth_gap',
        severity: 'medium',
        category: cat,
        description: `「${cat}」分类有${levels.total}本书但全部是入门级别，缺少进阶和专家级书籍。` +
          `用户可能在这个领域遇到了学习瓶颈，需要更深入的资源来突破。`,
        suggestion: `推荐「${cat}」领域的 Advanced 或 Expert 级别书籍`,
      });
    }
    if (levels.total >= 5 && levels.Basic > levels.Advanced + levels.Expert) {
      gaps.push({
        type: 'depth_imbalance',
        severity: 'low',
        category: cat,
        description: `「${cat}」分类入门书占比过高（${levels.Basic}/${levels.total}），可能停留在舒适区。`,
        suggestion: `适当挑战更高难度的书籍`,
      });
    }
  }

  // === 2. 广度缺口检测 ===
  const categoryCount = Object.keys(catLevelMap).length;
  if (categoryCount === 1) {
    gaps.push({
      type: 'breadth_gap',
      severity: 'high',
      description: `所有书籍都集中在一个领域（${Object.keys(catLevelMap)[0]}），缺少跨学科阅读。` +
        `单一领域的阅读容易形成信息茧房，建议拓展到相关或全新领域。`,
      suggestion: '推荐跨学科书籍或与当前领域互补的领域',
    });
  } else if (categoryCount === 2) {
    gaps.push({
      type: 'breadth_gap',
      severity: 'medium',
      description: `只有${categoryCount}个分类，阅读广度有限。跨界阅读能带来新的视角和灵感。`,
      suggestion: '推荐与现有领域有交叉的新领域书籍',
    });
  }

  // === 3. 应用缺口检测 ===
  // 通过书名和分类推断理论 vs 实践
  const theoryKeywords = ['原理', '导论', '理论', '基础', '概论', '思想', '哲学'];
  const practiceKeywords = ['实战', '实践', '项目', '手册', '指南', '案例', '动手', 'cookbook', '实战指南'];
  const theoryCount = library.filter(b =>
    theoryKeywords.some(kw => b.title.toLowerCase().includes(kw) || b.subcategory.toLowerCase().includes(kw))
  ).length;
  const practiceCount = library.filter(b =>
    practiceKeywords.some(kw => b.title.toLowerCase().includes(kw) || b.subcategory.toLowerCase().includes(kw))
  ).length;

  if (theoryCount > practiceCount * 2 && theoryCount >= 3) {
    gaps.push({
      type: 'application_gap',
      severity: 'medium',
      description: `书库中理论类书籍较多（${theoryCount}本），实践类较少（${practiceCount}本）。` +
        `理论需要实践来巩固，建议增加动手实践类的书籍。`,
      suggestion: '推荐实战、项目驱动、案例分析的书籍',
    });
  }

  // === 4. 进度缺口检测 ===
  const stuckBooks = library.filter(b =>
    b.status === BookStatus.READING &&
    b.userData &&
    b.userData.progressPercentage > 0 &&
    b.userData.progressPercentage < 30
  );

  if (stuckBooks.length > 0) {
    gaps.push({
      type: 'progress_gap',
      severity: 'medium',
      description: `有${stuckBooks.length}本书在读但进度低于30%：` +
        stuckBooks.map(b => `《${b.title}》(${Math.round(b.userData!.progressPercentage)}%)`).join('、') +
        `。可能这些书难度过高或内容不匹配，建议重新评估是否继续。`,
      suggestion: '推荐难度更低的入门书或寻找替代读物',
      stuckBookIds: stuckBooks.map(b => b.id),
    });
  }

  // === 5. 未读积压检测 ===
  const unreadCount = library.filter(b => b.status === BookStatus.UNREAD).length;
  const totalCount = library.length;
  if (unreadCount > totalCount * 0.6 && unreadCount > 5) {
    gaps.push({
      type: 'backlog_gap',
      severity: 'low',
      description: `未读书籍占${Math.round(unreadCount / totalCount * 100)}%（${unreadCount}/${totalCount}本），积压较多。` +
        `这可能意味着购书过于冲动或阅读速度跟不上。建议优先消化现有藏书。`,
      suggestion: '不建议继续推荐新书，帮助用户制定阅读计划',
    });
  }

  // === 综合评估 ===
  const highSeverity = gaps.filter(g => g.severity === 'high');
  const mediumSeverity = gaps.filter(g => g.severity === 'medium');
  const lowSeverity = gaps.filter(g => g.severity === 'low');

  return {
    totalGaps: gaps.length,
    highPriority: highSeverity,
    mediumPriority: mediumSeverity,
    lowPriority: lowSeverity,
    allGaps: gaps,
    overallAssessment: gaps.length === 0
      ? '阅读结构较为均衡，未发现明显的知识缺口。'
      : highSeverity.length > 0
        ? `发现${highSeverity.length}个高优先级缺口，建议优先关注。`
        : mediumSeverity.length > 0
          ? `发现${mediumSeverity.length}个中等优先级缺口，适当调整阅读方向。`
          : `发现${lowSeverity.length}个小问题，整体阅读状况良好。`,
  };
}

// ============================================================================
// 阅读笔记工具 — 获取用户在书籍上的思考记录
// ============================================================================

function getReadingNotes(args: Record<string, any>, library: Book[]): any {
  const { bookId } = args;

  if (bookId) {
    // 获取特定书籍的笔记
    const book = library.find(b => b.id === bookId);
    if (!book) {
      return { error: `未找到书籍ID: ${bookId}` };
    }
    return {
      bookId: book.id,
      title: book.title,
      author: book.author,
      notes: book.notes || [],
      noteCount: book.notes?.length || 0,
    };
  }

  // 获取所有有笔记的书籍概要
  const booksWithNotes = library
    .filter(b => b.notes && b.notes.length > 0)
    .map(b => ({
      bookId: b.id,
      title: b.title,
      author: b.author,
      noteCount: b.notes!.length,
      latestNote: b.notes![b.notes!.length - 1].slice(0, 100),
    }));

  return {
    totalBooksWithNotes: booksWithNotes.length,
    totalNotes: booksWithNotes.reduce((sum, b) => sum + b.noteCount, 0),
    books: booksWithNotes,
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
// 库概览生成 — 常驻上下文（紧凑格式 + 阅读品味画像）
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

  // === 新增：阅读品味画像（紧凑版） ===
  const tasteProfile = generateCompactTasteProfile(library);
  if (tasteProfile) {
    overview += `\n【阅读品味画像】\n${tasteProfile}\n`;
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

  overview += `\n提示：建议优先使用 get_reading_taste_profile 获取完整品味画像（含阅读人格分析），使用 get_reading_gaps 分析知识缺口，使用 get_reading_notes 查看用户阅读笔记。其他工具：搜索书库（含标签搜索）、获取书籍详情（含豆瓣标签和评分）、查看分类统计、查看阅读历史、查看用户画像。`;

  return overview;
}

/**
 * 生成紧凑版阅读品味画像（嵌入概览中）
 */
function generateCompactTasteProfile(library: Book[]): string | null {
  if (!library || library.length === 0) return null;

  const total = library.length;
  const reading = library.filter(b => b.status === BookStatus.READING);
  const finished = library.filter(b => b.status === BookStatus.FINISHED);

  // 难度偏好
  const levelDist = {
    Basic: library.filter(b => b.level === BookLevel.BASIC).length,
    Advanced: library.filter(b => b.level === BookLevel.ADVANCED).length,
    Expert: library.filter(b => b.level === BookLevel.EXPERT).length,
  };

  const difficultyPref = levelDist.Basic > levelDist.Advanced + levelDist.Expert ? '偏入门（可能停留在舒适区）'
    : levelDist.Expert > levelDist.Basic + levelDist.Advanced ? '偏专家（喜欢挑战）'
    : levelDist.Advanced > levelDist.Basic && levelDist.Advanced > levelDist.Expert ? '偏进阶（稳步成长）'
    : '均衡分布';

  // 完成率
  const finishRate = total > 0 ? Math.round(finished.length / total * 100) : 0;

  // 停滞的书
  const stuckCount = reading.filter(b =>
    b.userData && b.userData.progressPercentage > 0 && b.userData.progressPercentage < 30
  ).length;

  // 分类数
  const categories = new Set(library.map(b => b.category));
  const categoryCount = categories.size;

  // 集中度
  const catCounts: Record<string, number> = {};
  for (const b of library) {
    catCounts[b.category] = (catCounts[b.category] || 0) + 1;
  }
  const maxCatCount = Math.max(...Object.values(catCounts));
  const concentration = maxCatCount / total;

  let profile = `难度偏好: ${difficultyPref} (入门${levelDist.Basic}/进阶${levelDist.Advanced}/专家${levelDist.Expert})\n`;
  profile += `完成率: ${finishRate}%（已读${finished.length}/${total}）`;

  if (stuckCount > 0) {
    profile += `，有${stuckCount}本在读但进度停滞(<30%)`;
  }
  profile += `\n`;

  profile += `阅读广度: ${categoryCount}个领域，`;
  if (categoryCount <= 2) {
    profile += `聚焦度较高`;
  } else if (concentration > 0.5) {
    profile += `有主领域但兼顾其他`;
  } else {
    profile += `分布较为分散`;
  }

  // 作者偏好
  const authorFreq: Record<string, number> = {};
  for (const b of library) {
    authorFreq[b.author] = (authorFreq[b.author] || 0) + 1;
  }
  const topAuthor = Object.entries(authorFreq).find(([_, count]) => count >= 2);
  if (topAuthor) {
    profile += `\n偏好作者: ${topAuthor[0]}（${topAuthor[1]}本）`;
  }

  // 阅读人格（紧凑版）—— 复用上方已计算的 finishRate（百分比）
  const finishRatio = total > 0 ? finished.length / total : 0;
  const personality = finishRatio >= 0.7 ? '完成型' : finishRatio < 0.3 && total > 10 ? '探索型' : '平衡型';
  const focus = categoryCount <= 2 && total / categoryCount >= 5 ? '深度型' : categoryCount >= 6 ? '广度型' : '均衡型';
  profile += `\n阅读人格: ${personality}+${focus}`;

  // 笔记数量
  const notesCount = library.filter(b => b.notes && b.notes.length > 0).length;
  if (notesCount > 0) {
    profile += `\n有笔记的书: ${notesCount}本（可使用 get_reading_notes 查看用户思考）`;
  }

  return profile;
}
