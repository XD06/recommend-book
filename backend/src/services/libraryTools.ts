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
 *
 * v5：书库与画像改为按 userId 直读 SQLite（不再吃前端传来的快照），
 * 工具缓存改为请求作用域，update_book_status 直接落库。
 * v6：新增 update_user_profile 写工具 — 对话中问出来的偏好落回 user_profiles。
 * v7：修正喂给模型的"关于这个人"的信号 —— 画像未设置就不冒充（isProfileConfigured）、
 * 豆瓣分与用户自评分不再混算（resolveUserRating/resolveDoubanRating）、
 * 没有阅读行为就不推断阅读人格、未读多不再劝模型"别推荐新书"、
 * 关键词检索覆盖分类与子分类、采纳反馈有读取端。
 */

import { Book, BookStatus, BookLevel, UserProfile, ReadingLevel, AgentContext } from '../types';
import {
  updateBookProgressInDb,
  updateUserProfileInDb,
  addActivity,
  loadUserLibrary,
  loadUserProfile,
  summarizeRecommendationFeedback,
  addMemory,
  listMemories,
  selectRelevantMemories,
  touchMemoriesUsed,
  MEMORY_KINDS,
  MAX_ACTIVE_MEMORIES,
  UserProfilePatch,
} from '../db/database';
import { computeLibraryStats, formatCategoryDistribution, resolveUserRating, resolveDoubanRating } from './libraryStats';
import {
  WEB_TOOLS,
  executeWebTool,
  isWebTool,
  describeWebToolCall,
  isWebSearchEnabled,
} from './webSearchService';

// ============================================================================
// 工具结果缓存 — 请求作用域，同一轮 Agent 循环内避免重复查询
// ============================================================================

const TOOL_CACHE_MAX = 50;

/**
 * 书库概览完整注入书目上限：≤ 本数时提示词里就有全部 [id] 书名，
 * 模型不查工具也能给出真实 bookId；超过这个规模它看到的只是节选，
 * 凭空给出的 ID 必然是猜的 — 推荐路径的书库硬闸门按这条线决定是否启用。
 */
export const FULL_INDEX_LIMIT = 100;

/**
 * 画像是否真的被用户设置过。
 *
 * `user_profiles.reading_level` 在注册那一刻就被写成 'beginner'（routes/auth.ts），
 * 所以"表里有行 = 有画像"是错的。真实数据里的表现是：413 本书的用户，画像只有
 * 一行默认值（目标/偏好/时长/AI分析全空），而模型被明确告知"水平: beginner"，
 * 于是系统性地把推荐压回入门书——这是当下对个性化伤害最大的一条。
 *
 * 判定口径：任一"只有用户会填"的字段有值，或水平被改成过非默认值。
 * 宁可说"未设置"（模型会去问），也不要拿默认值冒充用户陈述。
 */
export function isProfileConfigured(profile?: UserProfile): boolean {
  if (!profile) return false;
  if (profile.readingLevel && profile.readingLevel !== 'beginner') return true;
  return Boolean(
    (profile.readingGoal && profile.readingGoal.trim()) ||
    (profile.preferredCategories && profile.preferredCategories.length > 0) ||
    (profile.dailyReadingTime && profile.dailyReadingTime > 0) ||
    profile.aiAnalysis,
  );
}

/** 生成缓存 key */
function getCacheKey(toolName: string, args: Record<string, any>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

/** 查询缓存（命中则移到 LRU 末尾） */
function getCachedToolResult(
  ctx: AgentContext,
  toolName: string,
  args: Record<string, any>,
): string | undefined {
  const key = getCacheKey(toolName, args);
  const result = ctx.toolCache.get(key);
  if (result !== undefined) {
    ctx.toolCache.delete(key);
    ctx.toolCache.set(key, result);
  }
  return result;
}

/** 写入缓存 */
function setCachedToolResult(
  ctx: AgentContext,
  toolName: string,
  args: Record<string, any>,
  result: string,
): void {
  const key = getCacheKey(toolName, args);
  if (ctx.toolCache.size >= TOOL_CACHE_MAX) {
    const firstKey = ctx.toolCache.keys().next().value;
    if (firstKey) ctx.toolCache.delete(firstKey);
  }
  ctx.toolCache.set(key, result);
}

/** 判断是否为写工具（写工具不缓存） */
/** 写工具必须排除在请求级工具缓存之外，否则会读到上一轮的旧结果 */
export function isWriteTool(toolName: string): boolean {
  return toolName === 'update_book_status' || toolName === 'update_user_profile' || toolName === 'remember';
}

/**
 * 画像类工具：它们证明模型看了"人"，但没看书目。
 * 书库硬闸门不认它们，否则一次 get_user_profile 就能蒙过闸门。
 * 记忆类同理：查记忆不等于查过书目。
 */
const PROFILE_TOOLS = new Set([
  'get_user_profile', 'update_user_profile',
  'remember', 'recall_memory',
]);

/**
 * 这次工具调用是否真的查过用户书目 — 供 Agent 循环统计"有没有查过书库"。
 * Web 工具不在内：它查的是站外信息，填不了 libraryMatches 的 bookId。
 */
export function isLibraryCatalogTool(toolName: string): boolean {
  return LIBRARY_TOOL_NAMES.has(toolName) && !PROFILE_TOOLS.has(toolName);
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
  {
    type: 'function' as const,
    function: {
      name: 'update_user_profile',
      description: '更新用户阅读画像（写操作）。当用户透露了稳定的阅读水平、阅读目标、偏好分类或每日阅读时间时使用，使下一次会话不必重新询问。'
        + '只写用户明确说过的内容，不要根据推荐结果或猜测反推；只传需要修改的字段，未传的字段保持不变。'
        + '每个字段都有来源：用户自己填过的字段属于用户的期望，你的推测不得覆盖——工具会拒绝并告诉你哪几个字段被拒，'
        + '这时要如实告诉用户你沿用了 TA 自己定的值。只有用户本轮明确要求改某个字段时，才把它标为 userStated=true。'
        + 'evidence 必填：直接引用用户的原话片段，它会连同"这是推测还是用户说的"一起展示给用户。',
      parameters: {
        type: 'object',
        properties: {
          readingLevel: { type: 'string', enum: ['beginner', 'intermediate', 'advanced', 'expert'], description: '自评阅读水平' },
          readingGoal: { type: 'string', description: '阅读目标（如"打牢系统编程基础"）' },
          preferredCategories: { type: 'array', items: { type: 'string' }, description: '偏好分类列表。覆盖式更新：传入即替换原有列表，必须先合并用户已有的偏好再提交' },
          dailyReadingTime: { type: 'number', description: '每日可用阅读时间（分钟）' },
          userStated: { type: 'boolean', description: '用户本轮是否明确说出了这些值（而不是你从别处推断）。只有 true 时才允许修改用户自己填过的字段；不确定就传 false' },
          evidence: { type: 'string', description: '必填：你依据用户哪句话写入的，直接引用原话片段（≤120字）' },
        },
        required: ['evidence'],
      },
    },
  },

  // ==========================================================================
  // 长期记忆 —— 没有槽位的事实／偏好／禁忌／约定
  //
  // 与画像是两件事：画像是有槽位的稳定属性（水平/目标/偏好分类/每日时长）；
  // 记忆是"我在准备考试""我不看成功学"这类塞不进槽位的东西。
  // 记忆**不得**回写画像字段，画像也不该塞进记忆——分工写死，避免来源保护被绕过。
  // ==========================================================================
  {
    type: 'function' as const,
    function: {
      name: 'remember',
      description: '长期记住一件事（写操作，跨会话生效）。用于用户**明确要求记住**的内容，'
        + '或用户说出的、塞不进画像字段的稳定信息（偏好、禁忌、约定、正在准备的考试等）。'
        + '不要记：能从书库查到的（藏书量、分类），一次性的情绪，你自己的推测。'
        + 'evidence 必填（用户原话片段）；userStated 只有"用户明确说了或要求记住"才传 true，'
        + '你自己判断值得记的传 false。内容要一句话说清，不要抄整段对话。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '要记住的事，一句话（≤200字），主语是用户。例：不看成功学类书籍' },
          kind: { type: 'string', enum: ['fact', 'preference', 'constraint', 'goal', 'event'], description: 'fact=事实、preference=偏好、constraint=禁忌/约束、goal=长期目标、event=有时限的事' },
          evidence: { type: 'string', description: '必填：用户原话片段（≤120字）' },
          userStated: { type: 'boolean', description: '用户是否明确说了/要求记住。不确定传 false' },
          expiresAt: { type: 'string', description: 'ISO 日期。仅 event 类需要（如"下个月要考试"→考试日期）；不传则按 60 天后过期' },
        },
        required: ['content', 'kind', 'evidence'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'recall_memory',
      description: '检索此前记下的长期记忆（读操作）。当你不确定用户的偏好、禁忌或此前约定过什么时用它，'
        + '而不是凭印象猜。返回与查询最相关的若干条，含类别与依据。'
        + '注入到上下文里的通常只有最相关的 3 条，所以需要更多背景时主动查。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要回忆的主题，例如"读书禁忌""最近在准备什么"' },
          limit: { type: 'number', description: '最多返回几条，默认 8，上限 20' },
        },
        required: ['query'],
      },
    },
  },
];

/** 书库工具名集合 — 供"这次回答有没有查过书库"的判定使用 */
const LIBRARY_TOOL_NAMES = new Set(LIBRARY_TOOLS.map((t) => t.function.name));

// ============================================================================
// 工具执行器
// ============================================================================

/** 书籍更新回调 — 用于通知前端 */
export type BookUpdateCallback = (bookId: string, updates: Partial<Book>) => void;

/**
 * 把采纳反馈读成一段文本。
 *
 * `recommendation_feedback` 建好之后一直只有写入方（前端按钮）和 REST 读接口，
 * 推荐链路从不读它 —— "用户点过想读/跳过"对下一次推荐零影响。这里是读取端。
 */
function buildFeedbackSummary(userId: string): string | undefined {
  const s = summarizeRecommendationFeedback(userId);
  if (s.want.length === 0 && s.skip.length === 0) return undefined;

  const fmt = (list: Array<{ title: string; category: string | null }>) =>
    list.map((x) => (x.category ? `《${x.title}》(${x.category})` : `《${x.title}》`)).join('、');

  const lines = [`最近 ${s.shownCount} 条推荐被展示过，用户点过「想读」${s.wantCount} 次、「跳过」${s.skipCount} 次。`];
  if (s.want.length) lines.push(`点过「想读」：${fmt(s.want)}`);
  if (s.skip.length) lines.push(`点过「跳过」：${fmt(s.skip)}`);
  lines.push('对「想读」的同类或同作者优先给出延续推荐；对「跳过」的不要原样再推，除非本次请求明确指向它。');
  return lines.join('\n');
}

/**
 * 装配一次 Agent 请求的上下文。由路由调用：客户端只交 userId（来自 JWT），
 * 书库与画像一律服务端取，避免"前端快照即模型真相"。
 */
export function createAgentContext(userId: string): AgentContext {
  return {
    userId,
    library: loadUserLibrary(userId),
    userProfile: loadUserProfile(userId),
    feedbackSummary: buildFeedbackSummary(userId),
    toolCache: new Map(),
    webCalls: 0,
    webCostUsd: 0,
  };
}

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
 * @param ctx 请求上下文（书库、画像来自 SQLite；缓存与 Web 计数随请求生死）
 * @param onBookUpdate 书籍更新回调 — 仍要通知前端：`useBookLibrary` 是防抖**全量**
 *                     覆盖保存，客户端不知道这次改动的话，下一次用户编辑任意一本
 *                     书都会把刚写入的状态冲掉
 * @returns JSON 格式的工具结果字符串
 */
export async function executeAllTools(
  toolName: string,
  args: Record<string, any>,
  ctx: AgentContext,
  onBookUpdate?: BookUpdateCallback,
): Promise<string> {
  // Web 工具走异步路径
  if (isWebTool(toolName)) {
    return executeWebTool(toolName, args, ctx);
  }
  // 书库工具走同步路径
  return executeLibraryTool(toolName, args, ctx, onBookUpdate);
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
    case 'update_user_profile':
      return '更新阅读画像';
    case 'remember':
      return `记住一件事${args.kind ? `（${args.kind}）` : ''}`;
    case 'recall_memory':
      return args.query ? `回忆关于「${String(args.query).slice(0, 12)}」的事` : '回忆此前记下的事';
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
  ctx: AgentContext,
  onBookUpdate?: BookUpdateCallback,
): string {
  const { library, userProfile } = ctx;
  try {
    // 写工具不缓存，直接执行
    if (!isWriteTool(toolName)) {
      const cached = getCachedToolResult(ctx, toolName, args);
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
        result = JSON.stringify(updateBookStatus(args, ctx, onBookUpdate));
        break;
      case 'update_user_profile':
        result = JSON.stringify(updateUserProfile(args, ctx));
        break;
      case 'remember':
        result = JSON.stringify(rememberMemory(args, ctx));
        break;
      case 'recall_memory':
        result = JSON.stringify(recallMemory(args, ctx));
        break;
      default:
        result = JSON.stringify({ error: `未知工具: ${toolName}` });
    }

    // 缓存读操作结果
    if (!isWriteTool(toolName)) {
      setCachedToolResult(ctx, toolName, args, result);
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
  /** 用户自评 1–5 星；未评过为 undefined */
  userRating?: number;
  /** 豆瓣评分 10 分制；与 userRating 不是同一件事 */
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
    // 两套量纲必须分开报：把豆瓣 8.4 当成"用户给了 8.4 分"，模型就会推出
    // "这个用户评价偏高、比较宽容"这种凭空捏造的人格判断
    userRating: resolveUserRating(book),
    doubanRating: resolveDoubanRating(book),
    progress: book.userData?.progressPercentage,
    tags: book.tags,
  };
}

/**
 * 关键词检索的覆盖范围。
 *
 * 原来只匹配 title/author/tags：实测书库里 79 本心理学书只有 17 本的书名或作者
 * 含"心理学"字样，模型传 keyword="心理学" 会得到"书里没有几本心理学书"的错误结论
 * （除非它恰好改用 category 参数）。分类、子分类、豆瓣标签与摘要一并纳入。
 */
function matchesKeyword(book: Book, kw: string): boolean {
  const haystack: Array<string | undefined> = [
    book.title,
    book.author,
    book.category,
    book.subcategory,
    ...(book.tags || []),
    ...(book.doubanData?.tags?.map((t) => t.name) || []),
    book.doubanData?.summary,
    book.aiInsight?.summary,
  ];
  return haystack.some((v) => typeof v === 'string' && v.toLowerCase().includes(kw));
}

function searchLibrary(args: Record<string, any>, library: Book[]): { total: number; books: BookBrief[] } {
  let result = [...library];

  if (args.keyword) {
    const kw = String(args.keyword).toLowerCase().trim();
    result = result.filter(b => matchesKeyword(b, kw));
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
    userRating: resolveUserRating(b),
    doubanRating: resolveDoubanRating(b),
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

  const s = computeLibraryStats(books);

  return {
    category,
    totalBooks: s.totals.total,
    reading: s.totals.reading,
    finished: s.totals.finished,
    unread: s.totals.unread,
    avgDoubanRating: s.doubanRating.count > 0 ? s.doubanRating.avg.toFixed(1) : null,
    avgUserRating: s.userRating.count > 0 ? s.userRating.avg.toFixed(1) : null,
    levelDistribution: s.levels,
    books: books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      level: b.level,
      status: b.status,
      progress: b.userData?.progressPercentage,
      userRating: resolveUserRating(b),
      doubanRating: resolveDoubanRating(b),
    })),
  };
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
    userRating: resolveUserRating(b),
    doubanRating: resolveDoubanRating(b),
    completionDate: b.userData?.completionDate,
    aiSummary: b.aiInsight?.summary?.slice(0, 100),
  }));
}

function getUserProfile(userProfile?: UserProfile): any {
  if (!isProfileConfigured(userProfile)) {
    return {
      configured: false,
      note: '用户尚未设置画像：没填过阅读水平/目标/偏好分类/每日时长，也没有 AI 分析。'
        + '不要在对话里假设 TA 的水平（默认值 beginner 不代表用户是初学者），'
        + '如需个性化请自然询问，问到后调用 update_user_profile 落盘。',
    };
  }

  const levelMap: Record<string, string> = {
    beginner: '初学者', intermediate: '中级读者', advanced: '高级读者', expert: '专家级',
  };
  const p = userProfile!;

  // 按来源分组返回：模型必须能一眼看出"哪些是用户定的（不可覆盖）、哪些是我自己记的
  // （可修正）、哪些还是空的（可以问）"。混成一个对象就会出现"拿推断当用户要求"。
  const fieldMeta = p.fieldMeta || {};
  const valueOf = (field: string): any => {
    switch (field) {
      case 'readingLevel': return p.readingLevel;
      case 'readingGoal': return p.readingGoal;
      case 'preferredCategories': return p.preferredCategories;
      case 'dailyReadingTime': return p.dailyReadingTime;
      case 'nickname': return p.nickname;
      default: return undefined;
    }
  };
  const isSet = (field: string): boolean => {
    const v = valueOf(field);
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== '';
  };

  const userStated: Record<string, any> = {};
  const aiRecorded: Array<{ field: string; value: any; evidence?: string; updatedAt?: string }> = [];
  const unset: string[] = [];

  for (const field of ['readingLevel', 'readingGoal', 'preferredCategories', 'dailyReadingTime']) {
    const meta = fieldMeta[field];
    if (!isSet(field)) { unset.push(field); continue; }
    if (meta?.source === 'user') {
      userStated[field] = valueOf(field);
      if (meta.via === 'conversation') userStated[`${field}_note`] = `用户在对话中明确说过（原话：${meta.evidence || '未记录'}）`;
    } else {
      aiRecorded.push({ field, value: valueOf(field), evidence: meta?.evidence, updatedAt: meta?.updatedAt });
    }
  }

  return {
    configured: true,
    lastUpdated: p.updatedAt,
    readingLevelLabel: levelMap[p.readingLevel] || p.readingLevel,
    /** 用户自己定的：权威，不要覆盖，也不要否定 */
    userStated,
    /** AI 记录的（可能是推测）：与用户当前说法冲突时以用户为准 */
    aiRecorded,
    /** 还没设置：可以自然地问，问到后用 update_user_profile 落盘 */
    unset,
    aiAnalysis: p.aiAnalysis ? {
      inferredLevel: p.aiAnalysis.inferredLevel,
      readingPattern: p.aiAnalysis.readingPattern,
      blindSpots: p.aiAnalysis.blindSpots,
      recommendedFocus: p.aiAnalysis.recommendedFocus,
      lastUpdated: p.aiAnalysis.lastUpdated,
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

  // 行为数据是否真的存在 —— 没有它，一切"阅读人格"推断都是把藏书目录当阅读日志
  const progressRecords = library.filter(b => (b.userData?.progressPercentage || 0) > 0).length;
  const hasBehaviorData = finished.length > 0 || progressRecords > 0;

  // === 6. 评分倾向（只用用户自评，且样本足够才算） ===
  // 历史坑：这里原先是 `library.filter(b => b.rating)`，而导入期把豆瓣分（10 分制）
  // 写进了 rating —— 实测 395 条里 393 条 > 5、均值 8.43，判据 `avg >= 4.2` 恒真，
  // 于是模型被告知"这个用户评价偏高、比较宽容或只选好书"，而真人只亲手评过 2 本。
  const MIN_RATING_SAMPLES = 3;
  const userRatedBooks = library
    .map(b => ({ book: b, value: resolveUserRating(b) }))
    .filter(x => x.value !== undefined) as Array<{ book: Book; value: number }>;
  const ratingTendency = userRatedBooks.length >= MIN_RATING_SAMPLES
    ? (() => {
        const avg = userRatedBooks.reduce((s, x) => s + x.value, 0) / userRatedBooks.length;
        return {
          avgRating: avg.toFixed(1),
          ratingCount: userRatedBooks.length,
          scale: '1-5 星（用户自评）',
          tendency: avg >= 4.2 ? '评价偏高，可能比较宽容或只选好书'
            : avg < 3.2 ? '评价偏严，对书籍质量要求高'
            : '评价适中',
        };
      })()
    : {
        ratingCount: userRatedBooks.length,
        note: `用户亲手评分过的书只有 ${userRatedBooks.length} 本（不足 ${MIN_RATING_SAMPLES} 本），不足以判断评价倾向。豆瓣评分是大众评分，不能当作这个用户的偏好。`,
      };

  // === 7. 阅读人格推断（深度个性化） ===
  const readingPersonality: any = (() => {
    // 0 本读完 + 无任何进度 ≠ "这是个不追求读完的人"，而是"还不知道这个人怎么读"。
    // 真实数据里正是这个状态：413 本藏书、0 本读完、4 本"在读"进度全为 0，
    // 旧逻辑据此输出"探索型读者（广泛涉猎，不追求读完）"——一句凭空的人格判决。
    if (!hasBehaviorData) {
      return {
        insufficientData: true,
        note: '尚无阅读行为记录（没有读完的书，也没有任何阅读进度），无法推断阅读人格。'
          + '不要把"藏书多但还没读"解释成"停留在舒适区""不追求读完""购书冲动"或"阅读不连贯"——那只是书目刚建立。',
      };
    }
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

    return { insufficientData: false, readerType, depthBreadth, learningStyle, consistency, difficultyEvolution };
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
    /** 行为数据是否存在。false 时上面除 knowledgeStructure / preferenceProfile 外的推断都不可信 */
    hasBehaviorData,
    summary: `藏书${total}本（在读${reading.length}、已读${finished.length}、未读${unread.length}），` +
      `主要领域：${topCategories.slice(0, 3).map(c => c.category).join('、')}。` +
      `难度偏好：${preferenceProfile.difficultyPreference}。` +
      (hasBehaviorData
        ? `阅读节奏：完成率${readingPace.finishedRate}，` +
          (readingPace.stuckBooks > 0 ? `有${readingPace.stuckBooks}本在读但进度停滞。` : '')
        : `阅读行为：尚无记录（未读完任何一本、也没有任何进度数据），不要据此推断阅读习惯。`) +
      (trajectory.categoryHopping ? trajectory.categoryHopping : '') +
      (readingPersonality.insufficientData
        ? `\n阅读人格：${readingPersonality.note}`
        : `\n阅读人格：${readingPersonality.readerType}，${readingPersonality.depthBreadth}，${readingPersonality.learningStyle}。` +
          `${readingPersonality.consistency}。难度进化：${readingPersonality.difficultyEvolution}。`),
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

  // === 5. 未读积压检测（先判断这是"积压"还是"刚建好的书目"） ===
  const unreadCount = library.filter(b => b.status === BookStatus.UNREAD).length;
  const totalCount = library.length;
  const finishedCount = library.filter(b => b.status === BookStatus.FINISHED).length;
  const progressRecords = library.filter(b => (b.userData?.progressPercentage || 0) > 0).length;
  const hasBehaviorData = finishedCount > 0 || progressRecords > 0;

  if (unreadCount > totalCount * 0.6 && unreadCount > 5 && !hasBehaviorData) {
    // 真实数据就是这个状态：413 本里 409 本未读、0 本读完、无任何进度。
    // 旧逻辑在这里输出"购书冲动、阅读速度跟不上"并建议"不建议继续推荐新书"——
    // 一个荐书应用对着一份刚导入的书目，把自己劝停了。
    gaps.push({
      type: 'catalog_not_started',
      severity: 'info',
      description: `书库 ${totalCount} 本中 ${unreadCount} 本未读，且没有任何阅读行为记录（0 本读完、无进度数据）——` +
        `这看起来是刚建立的书目，而不是"积压"。`,
      suggestion: '正常推荐即可，并可顺带给出"先从哪本开始"的建议；不要据此判断用户读不完书，也不要因此拒绝推荐新书。',
    });
  } else if (unreadCount > totalCount * 0.6 && unreadCount > 5) {
    gaps.push({
      type: 'backlog_gap',
      severity: 'low',
      description: `未读书籍占${Math.round(unreadCount / totalCount * 100)}%（${unreadCount}/${totalCount}本），存量偏多。`,
      suggestion: '在推荐里可以优先安排已有藏书的阅读顺序，但这只是排序偏好，不代表不能推荐新书。',
    });
  }

  // === 综合评估 ===
  const highSeverity = gaps.filter(g => g.severity === 'high');
  const mediumSeverity = gaps.filter(g => g.severity === 'medium');
  const lowSeverity = gaps.filter(g => g.severity === 'low');
  const infoItems = gaps.filter(g => g.severity === 'info');

  return {
    totalGaps: gaps.length,
    highPriority: highSeverity,
    mediumPriority: mediumSeverity,
    lowPriority: lowSeverity,
    info: infoItems,
    /** 行为数据是否存在。false 时"进度缺口"类判断无从谈起 */
    hasBehaviorData,
    allGaps: gaps,
    overallAssessment: gaps.length === 0
      ? '阅读结构较为均衡，未发现明显的知识缺口。'
      : highSeverity.length > 0
        ? `发现${highSeverity.length}个高优先级缺口，建议优先关注。`
        : mediumSeverity.length > 0
          ? `发现${mediumSeverity.length}个中等优先级缺口，适当调整阅读方向。`
          : lowSeverity.length > 0
            ? `发现${lowSeverity.length}个小问题，整体阅读状况良好。`
            : `仅有 ${infoItems.length} 条提示（书库尚未开始记录阅读行为），不构成知识缺口。`,
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
// 写工具实现 — update_book_status / update_user_profile
// ============================================================================

function updateBookStatus(
  args: Record<string, any>,
  ctx: AgentContext,
  onBookUpdate?: BookUpdateCallback,
): { success: boolean; message: string; book?: any } {
  const { library } = ctx;
  const { bookId, status, currentPage, rating } = args;
  const book = library.find(b => b.id === bookId);
  if (!book) {
    return { success: false, message: `未找到书籍ID: ${bookId}` };
  }

  const updates: Partial<Book> = {};
  // 记动态要用**改之前**的状态：下面几段直接改 book.status（同一引用），
  // 事后再读就永远是"新状态"，diff 恒为 false
  const prevStatus = book.status;

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

  // 更新评分：写 user_data.userRating，不再动 books.rating
  // （rating 列里躺着导入期的豆瓣分，混着写会让两套量纲彻底分不开）
  if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
    book.userRating = rating;
    book.userData = { ...(book.userData || { totalPages: 0, currentPage: 0, progressPercentage: 0 }), userRating: rating };
    updates.userRating = rating;
    updates.userData = book.userData;
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

  const persisted = updateBookProgressInDb(ctx.userId, bookId, {
    status: updates.status,
    userRating: updates.userRating,
    userData: updates.userData,
  });

  // 写入改变了后续查询的答案，本轮已缓存的读结果全部作废
  ctx.toolCache.clear();

  // 通知前端，防止它下一次全量保存时把刚写入的状态冲掉
  if (onBookUpdate) {
    onBookUpdate(bookId, updates);
  }

  if (!persisted) {
    return {
      success: false,
      message: `《${book.title}》未能写入数据库（可能已被删除），状态改动不会保留`,
    };
  }

  // 状态真正变化才记动态（AI 反复确认同一状态不该刷屏）
  if (prevStatus !== status && (status === 'reading' || status === 'finished')) {
    addActivity(ctx.userId, bookId, book.title, status === 'reading' ? 'started' : 'finished');
  }

  return {
    success: true,
    message: `已更新《${book.title}》的状态为: ${status}`,
    book: toBrief(book),
  };
}

/**
 * 把"模型给的画像字段"规范化成可写 patch。
 *
 * 抽出来是因为现在有**两条**写画像的路径：对话中的 `update_user_profile` 工具，
 * 以及回合结束后异步抽取（`/api/ai/profile/extract`）。两边各写一份校验必然会漂移
 * ——一条接受 "中级"、另一条拒绝，或者一条把时长截到 600、另一条不截。
 * 字段校验集中在这里：模型会给 "中级" 这类中文值或超范围的分钟数。
 */
export function normalizeProfilePatch(args: Record<string, any>): {
  patch: UserProfilePatch;
  changed: string[];
  invalid: string[];
} {
  const patch: UserProfilePatch = {};
  const invalid: string[] = [];
  const changed: string[] = [];

  const levels: ReadingLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
  if (args.readingLevel !== undefined) {
    if (levels.includes(args.readingLevel)) {
      patch.readingLevel = args.readingLevel;
      changed.push('readingLevel');
    } else {
      invalid.push(`readingLevel="${args.readingLevel}" 不在 ${levels.join('/')} 之内`);
    }
  }

  if (args.readingGoal !== undefined) {
    const goal = String(args.readingGoal).trim();
    if (goal) {
      patch.readingGoal = goal.slice(0, 200);
      changed.push('readingGoal');
    }
  }

  if (args.preferredCategories !== undefined) {
    if (Array.isArray(args.preferredCategories)) {
      patch.preferredCategories = args.preferredCategories
        .map((c: any) => String(c).trim())
        .filter(Boolean)
        .slice(0, 10);
      changed.push('preferredCategories');
    } else {
      invalid.push('preferredCategories 必须是字符串数组');
    }
  }

  if (args.dailyReadingTime !== undefined) {
    const minutes = Number(args.dailyReadingTime);
    if (Number.isFinite(minutes) && minutes > 0) {
      patch.dailyReadingTime = Math.min(Math.round(minutes), 600);
      changed.push('dailyReadingTime');
    } else {
      invalid.push(`dailyReadingTime="${args.dailyReadingTime}" 应为正整数分钟`);
    }
  }

  return { patch, changed, invalid };
}

/**
 * 把对话里问出来的稳定偏好落进 user_profiles。
 *
 * 没有这一步，Agent 花两轮问清的阅读水平/目标在下次会话里全部作废，
 * "AI 主动询问 → 记住 → 下次不问"就退化成每次重新问。
 */
function updateUserProfile(args: Record<string, any>, ctx: AgentContext): any {
  const { patch, changed, invalid } = normalizeProfilePatch(args);

  if (changed.length === 0) {
    return {
      success: false,
      message: '没有可更新的画像字段',
      ...(invalid.length > 0 && { invalid }),
    };
  }

  // 来源判定是这个工具最容易出错的地方：
  // · 用户在本次对话里**明确说出**了这个值 → 那是用户的话，来源 'user'（via=conversation），
  //   允许改用户自己填过的字段（用户当然可以改自己的期望）。
  // · 你**推断**出来的值 → 来源 'ai'，只能填空白字段或改自己之前写的字段。
  // 把推断伪装成 userStated=true 会让 AI 的猜测覆盖掉用户的期望，比不写更糟。
  const userStated = args.userStated === true;
  const evidence = typeof args.evidence === 'string' ? args.evidence.trim() : '';

  const result = updateUserProfileInDb(ctx.userId, patch, {
    source: userStated ? 'user' : 'ai',
    via: userStated ? 'conversation' : undefined,
    evidence: evidence || undefined,
  });

  // 画像刚变，本轮已缓存的 get_user_profile / 品味分析结果就过期了；
  // ctx.userProfile 同步刷新，本次回答的后续轮次能立刻看到新画像
  ctx.userProfile = result.profile;
  ctx.toolCache.clear();

  const accepted = changed.filter((f) => result.written.includes(f));

  return {
    success: result.written.length > 0,
    message: result.written.length > 0
      ? `已记住画像更新：${result.written.join('、')}`
      : '本次没有写入任何字段',
    written: result.written,
    ...(accepted.length > 0 && { changed: accepted }),
    ...(result.refused.length > 0 && {
      refused: result.refused,
      refusedHint: '以上字段用户自己定过（设置页填写或此前在对话里明确说过），属于用户的期望，'
        + '不接受你的推测覆盖。请如实告诉用户你沿用了 TA 自己定的内容、并说明你的判断与它不同在哪里；'
        + '只有用户本轮明确要求改、且你以 userStated=true 重发该字段时才能改。',
    }),
    ...(invalid.length > 0 && { invalid }),
    profile: getUserProfile(result.profile),
  };
}

/**
 * 长期记忆：写入。
 *
 * 与画像写入的区别：画像有槽位、有来源保护；记忆是自由文本，只做三件事保证它不被玩坏
 * —— 必须带用户原话依据、同内容去重、**被用户删过的内容永不复活**。
 */
function rememberMemory(args: Record<string, any>, ctx: AgentContext): any {
  const content = String(args.content || '').trim();
  const kind = (MEMORY_KINDS as readonly string[]).includes(args.kind) ? String(args.kind) : null;
  const evidence = typeof args.evidence === 'string' ? args.evidence.trim() : '';
  const userStated = args.userStated === true;

  if (!content) return { success: false, message: 'content 不能为空' };
  if (!kind) return { success: false, message: `kind 必须是 ${MEMORY_KINDS.join('/')} 之一`, received: args.kind ?? null };
  if (!evidence) {
    return {
      success: false,
      message: 'evidence 必填',
      hint: '必须引用用户原话片段：它是事后判断这条记忆真伪的唯一凭据，没有它就不允许写入',
    };
  }

  const result = addMemory(ctx.userId, {
    kind,
    content,
    evidence,
    source: userStated ? 'user' : 'ai',
    origin: 'explicit',
    confidence: userStated ? 0.95 : 0.6,
    expiresAt: typeof args.expiresAt === 'string' && args.expiresAt ? args.expiresAt : null,
  });

  if (!result.added) {
    const hints: Record<string, string> = {
      duplicate: '这条已经记过了，不要重复记',
      rejected_before: '用户此前**删除过**同样内容的记忆。删除是终态——不要再记它，也不要主动提起',
      limit_reached: `这个用户的活跃记忆已达上限（${MAX_ACTIVE_MEMORIES} 条）。改为用 recall_memory 看现有记忆，并提示用户整理；不要继续新增`,
      empty: 'content 为空',
    };
    return { success: false, reason: result.reason, message: hints[result.reason || 'empty'] };
  }

  // 记忆变了，本轮已缓存的 recall_memory 结果作废
  ctx.toolCache.clear();
  const m = result.memory!;
  return {
    success: true,
    message: `已记住：${m.content}`,
    memory: { id: m.id, kind: m.kind, content: m.content, source: m.source, expiresAt: m.expiresAt },
    note: userStated
      ? '这条记为"用户所说"，会展示给用户并可删除'
      : '这条记为"你的判断"，会展示给用户并可删除',
  };
}

/** 长期记忆：检索。相关度不够时退回最近若干条，避免"明明记过却查不到" */
function recallMemory(args: Record<string, any>, ctx: AgentContext): any {
  const query = String(args.query || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);

  // 检索时放宽单条长度上限：这里是模型主动查，不是常驻注入
  const picked = selectRelevantMemories(ctx.userId, query, limit, 4000);
  const rows = picked.length > 0 ? picked : listMemories(ctx.userId, { status: 'active', limit });
  if (rows.length === 0) return { total: 0, memories: [], note: '没有记下任何相关的事' };

  touchMemoriesUsed(ctx.userId, rows.map((r) => r.id));
  return {
    total: rows.length,
    memories: rows.map((r) => ({
      id: r.id, kind: r.kind, content: r.content,
      evidence: r.evidence, expiresAt: r.expiresAt, createdAt: r.createdAt,
    })),
  };
}

/** 记忆类别的中文标签，注入时用 */
const MEMORY_KIND_LABELS: Record<string, string> = {
  fact: '事实', preference: '偏好', constraint: '禁忌/约束', goal: '目标', event: '有时限的事',
};

/**
 * 注入用的长期记忆块 —— **检索式，不是全量**。
 *
 * 上限写死：≤3 条、内容合计 <500 字符（`selectRelevantMemories` 的 maxChars 管这个）。
 * 理由是量级：画像 4 个字段 160 字符可以无脑全发，记忆会长到几百条；全量注入会稀释
 * 指令，而"370 行提示词里第 35 行那句话被稀释到 0 次触发"是这个仓库付过学费的教训。
 */
export function buildMemoryBlock(userId: string, query: string): string {
  const picked = selectRelevantMemories(userId, query, 3, 500);
  if (picked.length === 0) return '';

  touchMemoriesUsed(userId, picked.map((r) => r.id));
  const lines = picked.map((r) => {
    const exp = r.expiresAt ? `（${r.expiresAt.slice(0, 10)} 到期）` : '';
    const ev = r.evidence ? `，依据"${r.evidence.slice(0, 40)}"` : '';
    return `- [${MEMORY_KIND_LABELS[r.kind] || r.kind}] ${r.content.slice(0, 120)}${exp}${ev}`;
  });
  return `\n\n【长期记忆】以下是此前记下的、与你这次问题相关的事（可能过时，与用户当前说法冲突时以当前为准；不要当作硬要求复述）：\n`
    + lines.join('\n')
    + `\n需要更多背景时可以调用 recall_memory。\n`;
}

// ============================================================================
// 库概览生成 — 常驻上下文（紧凑格式 + 阅读品味画像）
// ============================================================================

export function buildLibraryOverview(library: Book[]): string {
  const total = library.length;
  const reading = library.filter(b => b.status === BookStatus.READING);
  const finished = library.filter(b => b.status === BookStatus.FINISHED);
  const unread = library.filter(b => b.status === BookStatus.UNREAD);

  const stats = computeLibraryStats(library);

  let overview = `【书库概览】共 ${total} 本（在读 ${reading.length}，已读 ${finished.length}，未读 ${unread.length}）\n`;
  overview += `【分类分布】${formatCategoryDistribution(stats)}\n`;
  overview += `【难度分布】入门${stats.levels[BookLevel.BASIC]}、进阶${stats.levels[BookLevel.ADVANCED]}、专家${stats.levels[BookLevel.EXPERT]}\n`;

  // 评分：豆瓣分与用户自评分开报，并写明量纲 —— 否则模型会把豆瓣 8.4 读成
  // "用户给了 8.4 分"，进而推出一个关于这个人的错误结论
  if (stats.doubanRating.count > 0) {
    overview += `【豆瓣评分】已收录 ${stats.doubanRating.count} 本的豆瓣分，平均 ${stats.doubanRating.avg.toFixed(1)}（10 分制，大众评分，不代表用户偏好）\n`;
  }
  if (stats.userRating.count > 0) {
    overview += `【用户自评】${stats.userRating.count} 本，平均 ${stats.userRating.avg.toFixed(1)} 星（5 分制，用户亲手评的）\n`;
  } else {
    overview += `【用户自评】暂无 —— 用户还没有亲手评分过任何书，不要从豆瓣分推断 TA 的评价倾向\n`;
  }

  // === 新增：阅读品味画像（紧凑版） ===
  const tasteProfile = generateCompactTasteProfile(library);
  if (tasteProfile) {
    overview += `\n【阅读品味画像】\n${tasteProfile}\n`;
  }

  // 在读书籍详情（通常只有几本，直接传）
  if (reading.length > 0) {
    // 实测踩过的坑：4 本"在读"的进度全是 0%，模型据此推断"同时啃 4 本导致启动困难""认知过载"。
    // 进度为 0% 通常只是用户没去记录，不是行为证据，所以在这里把口径写死。
    overview += `\n【在读书籍】（进度为 0% 只说明还没在界面上记录进度，不代表没在读，不要据此推断阅读困难或认知过载）\n`;
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
      const rating = resolveUserRating(b);
      const ratingText = rating ? ` ${rating}★(自评)` : '';
      overview += `[${b.id}] 《${b.title}》- ${b.author} [${b.category}] (${b.level}${ratingText})\n`;
    }
  }

  // 书库索引分档：全量注入在 >100 本时会挤掉对话历史，而 AI 无法区分"看全了"和"只看到一部分"，
  // 于是会拿节选当全集推荐。因此每档都显式声明覆盖范围。
  const fmtIndex = (b: Book) => {
    const statusIcon = b.status === BookStatus.READING ? '📖' : b.status === BookStatus.FINISHED ? '✓' : '○';
    return `[${b.id}] ${statusIcon} 《${b.title}》- ${b.author} [${b.category}/${b.subcategory}] (${b.level})`;
  };

  /** 完整注入上限 — 见文件级 FULL_INDEX_LIMIT */
  const CURATED_INDEX_LIMIT = 300;
  const PER_CATEGORY_INDEX = 3;

  if (total <= FULL_INDEX_LIMIT) {
    overview += `\n【书库索引 · 完整（${total}/${total} 本）】\n`;
    overview += library.map(fmtIndex).join('\n') + '\n';
  } else if (total <= CURATED_INDEX_LIMIT) {
    const picked = new Map<string, Book>();
    for (const b of reading) picked.set(b.id, b);
    for (const b of recentFinished) picked.set(b.id, b);
    const byCategory: Record<string, Book[]> = {};
    for (const b of library) (byCategory[b.category] ||= []).push(b);
    for (const list of Object.values(byCategory)) {
      list.sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));
      for (const b of list.slice(0, PER_CATEGORY_INDEX)) picked.set(b.id, b);
    }
    overview += `\n【书库索引 · 节选（${picked.size}/${total} 本：全部在读 + 最近读完 + 各分类最新 ${PER_CATEGORY_INDEX} 本），其余 ${total - picked.size} 本看不到书名，必须用 search_library / get_category_stats 查询后再推荐，不要假设书库里只有这些】\n`;
    overview += [...picked.values()].map(fmtIndex).join('\n') + '\n';
  } else {
    // 不注入书名：413 本级别的索引会让常驻上下文膨胀数倍，而按分类取书名本来就是
    // get_category_stats 的强项（它返回该分类全部书籍）。这里只声明"书名要靠工具拿"。
    overview += `\n【书库索引 · 未注入（共 ${total} 本，超出注入上限 ${CURATED_INDEX_LIMIT} 本）】除上面的「在读书籍」与「最近读完」，概览里没有任何书名。必须先用 get_category_stats / search_library 拿到候选书目再推荐，禁止凭分类名臆测用户读了什么书。\n`;
  }

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

  const hasBehaviorData = finished.length > 0 || library.some(b => (b.userData?.progressPercentage || 0) > 0);

  let profile = `难度偏好: ${difficultyPref} (入门${levelDist.Basic}/进阶${levelDist.Advanced}/专家${levelDist.Expert})\n`;
  if (hasBehaviorData) {
    profile += `完成率: ${finishRate}%（已读${finished.length}/${total}）`;
    if (stuckCount > 0) {
      profile += `，有${stuckCount}本在读但进度停滞(<30%)`;
    }
    profile += `\n`;
  } else {
    // 0 本读完 + 无任何进度：这是"还没开始记录阅读"，不是"读不完"。
    // 概述是常驻上下文，这句话说错会污染每一次推荐。
    //
    // 措辞从"别用这几个词"改成"别做这件事"：原来只列了"不追求读完/停留在舒适区/购书冲动"，
    // 结果实测模型换了个说法继续判——"这很像囤积式阅读：用收藏代替阅读，用广度代替深度"。
    // 枚举永远列不全，所以直接禁止"从藏书推断阅读习惯"这一类行为，并点名几个典型说法。
    profile += `阅读行为: 尚无记录（0 本读完、无进度数据）——这是一份刚建立的书目。`
      + `**不要从藏书推断任何阅读习惯**：包括"不追求读完""停留在舒适区""购书冲动""囤积式阅读"` +
      `"用收藏代替阅读""广度代替深度""启动困难"这类判断，都不许下。也不要因此减少推荐\n`;
  }

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

  // 阅读人格（紧凑版）——没有阅读行为时只描述藏书结构，不做人格推断
  const focus = categoryCount <= 2 && total / categoryCount >= 5 ? '深度型' : categoryCount >= 6 ? '广度型' : '均衡型';
  if (hasBehaviorData) {
    const finishRatio = total > 0 ? finished.length / total : 0;
    const personality = finishRatio >= 0.7 ? '完成型' : finishRatio < 0.3 && total > 10 ? '探索型' : '平衡型';
    profile += `\n阅读人格: ${personality}+${focus}（据阅读行为推断）`;
  } else {
    profile += `\n藏书结构: ${focus}（仅按藏书分布描述，不代表阅读行为）`;
  }

  // 笔记数量
  const notesCount = library.filter(b => b.notes && b.notes.length > 0).length;
  if (notesCount > 0) {
    profile += `\n有笔记的书: ${notesCount}本（可使用 get_reading_notes 查看用户思考）`;
  }

  return profile;
}
