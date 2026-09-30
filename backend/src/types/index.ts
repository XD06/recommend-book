// ============================================================================
// 书籍相关类型
// ============================================================================

export enum BookStatus {
  UNREAD = 'unread',
  READING = 'reading',
  FINISHED = 'finished'
}

export enum BookLevel {
  BASIC = 'Basic',
  ADVANCED = 'Advanced',
  EXPERT = 'Expert'
}

export interface UserProgress {
  totalPages: number;
  currentPage: number;
  progressPercentage: number;
  startDate?: string;
  completionDate?: string;
  /** 用户自评 1–5 星。存放位置就是这个 JSON（books.user_data），不需要加列 */
  userRating?: number;
}

export interface AIInsight {
  summary: string;
  advice: string;
  keyChapters: string[];
}

/**
 * 核心书籍数据模型
 */
export interface Book {
  id: string;
  title: string;
  author: string;
  publisher?: string;

  // 分类系统（支持多级）
  category: string;        // 一级分类：领域/学科
  subcategory: string;     // 二级分类：具体主题
  tags?: string[];         // 标签：更细粒度的标记

  level: BookLevel;
  status: BookStatus;
  userData?: UserProgress;
  aiInsight?: AIInsight;

  // 封面（生成色或真实图片）
  coverColor?: string;
  coverUrl?: string;

  // 评分：两套量纲，禁止混用。豆瓣是 10 分制，用户自评是 1–5 星。
  rating?: number;         // 历史遗留：导入期把豆瓣分写进了这里（值 >5 即豆瓣量纲），新数据不再写
  userRating?: number;     // 用户自评 1–5 星（权威存储是 userData.userRating）
  doubanRating?: number;   // 豆瓣评分（10 分制，权威来源为 doubanData.rating_score）

  // 阅读笔记（用户记录的思考、感悟、问题）
  notes?: string[];

  // 豆瓣数据（Phase 2）
  doubanId?: string;
  isbn?: string;
  publishYear?: string;
  doubanData?: DoubanBookData;

  // 元数据
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 豆瓣数据类型（与 douban_mini 抓取器对齐）
// ============================================================================

export interface Comment {
  user_name: string;
  user_url?: string;
  rating: string;
  rating_stars?: number;
  date: string;
  content: string;
  votes: number;
}

export interface DoubanBookData {
  id: string;
  title: string;
  subtitle?: string;
  original_title?: string;
  author: string[];
  translator?: string[];
  publisher: string;
  producer?: string;
  pubdate: string;
  publish_year?: string;
  isbn?: string;
  isbn13?: string;
  isbn10?: string;
  pages?: number;
  binding?: string;
  price?: string;
  series?: string;
  cover_url?: string;
  images?: {
    small: string;
    medium: string;
    large: string;
  };
  // 评分信息
  rating_score?: number;
  rating_count?: number;
  rating_distribution?: Record<string, number>; // {"5": 88.8, "4": 9.1, ...}
  rating?: {
    average: string;
    numRaters: number;
  };
  // 阅读状态统计
  reading_status?: {
    reading: number;
    read: number;
    want_to_read: number;
  };
  summary: string;
  tags?: { name: string; count: number }[];
  url?: string;
  works_id?: string;
  // 短评（用于 AI 分析）
  comments?: Comment[];
  scraped_at?: string;
}

// ============================================================================
// 分类系统类型
// ============================================================================

/**
 * 分类节点 - 支持树形结构
 */
export interface CategoryNode {
  id: string;
  name: string;
  level: number;           // 0: 根, 1: 一级, 2: 二级, 3: 标签
  parentId?: string;       // 父节点ID
  path: string[];          // 完整路径 ['计算机科学', '人工智能', '机器学习']
  description?: string;    // AI生成的分类描述
  bookCount: number;
  children?: CategoryNode[];
}

/**
 * 分类上下文 - 用于AI对话时传递分类信息
 */
export interface CategoryContext {
  currentCategory: string;     // 当前选中的分类
  parentCategories: string[];  // 父级分类链
  siblingCategories: string[]; // 同级分类
  subCategories: string[];     // 子分类
  booksInContext: Book[];      // 该分类下的书籍
  totalBooks: number;
  readingStats: {
    reading: number;
    finished: number;
    unread: number;
  };
}

// ============================================================================
// AI 相关类型
// ============================================================================

export type ReadingLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * 画像字段的来源。两类信息的性质完全不同，绝不能混为一谈：
 * - `user`：用户自己填的（设置页）或用户在对话里明确说的 —— 是**用户的期望**，
 *   可能不够详细、不够准确，但它是权威，AI 的推测不得覆盖它。
 * - `ai`：AI 从对话里记录/推断的 —— 是**猜测**，可能不准，必须可被修正，
 *   所以要连依据（用户原话）一起存下来。
 */
export type ProfileFieldSource = 'user' | 'ai';

export interface ProfileFieldMeta {
  source: ProfileFieldSource;
  /** 来源渠道：设置页表单 / 对话中明确陈述（仅 source='user' 时有意义） */
  via?: 'form' | 'conversation';
  /** 写入依据（用户原话片段）。AI 记录时必填，供"这是推测，依据是…"展示 */
  evidence?: string;
  updatedAt?: string;
}

export interface UserProfile {
  nickname?: string;
  readingLevel: ReadingLevel;
  readingGoal?: string;
  preferredCategories: string[];
  dailyReadingTime?: number;
  /** 画像最后更新时间（user_profiles.updated_at）。注入给模型时用来提示画像是否过期 */
  updatedAt?: string;
  /** 逐字段的来源元数据（见 ProfileFieldSource）。缺省表示该字段从未被写过 */
  fieldMeta?: Record<string, ProfileFieldMeta>;
  aiAnalysis?: {
    inferredLevel: ReadingLevel;
    readingPattern: string;
    blindSpots: string[];
    recommendedFocus: string;
    lastUpdated: string;
  };
}

export interface AIRequestContext {
  // 用户请求信息
  userRequest: string;
  userMood?: string;
  userProfile?: UserProfile;

  // 可选的上下文限制
  categoryContext?: CategoryContext;  // 如果指定了分类，只在该分类下搜索

  // 书库数据（根据上下文动态筛选）
  library: Book[];

  // 历史对话（用于多轮对话）
  conversationHistory?: ChatMessage[];
}

// ============================================================================
// Agent 请求上下文
// ============================================================================

/**
 * 一次 Agent 调用一份。书库与画像从 SQLite 载入，工具结果缓存与 Web 调用计数
 * 随请求生死——放在模块级会让并发请求互清缓存，并把"每次对话 5 次 Web 调用"
 * 变成"整个进程 5 次"。
 */
export interface AgentContext {
  userId: string;
  library: Book[];
  userProfile?: UserProfile;
  /**
   * 采纳反馈摘要（想读 / 跳过），由 createAgentContext 从 recommendation_feedback 读成一行文本。
   * 没有读取方时这张表只是账本，读回来才能影响下一次排序。
   */
  feedbackSummary?: string;
  /** 工具结果缓存，key 为 `toolName:JSON.stringify(args)` */
  toolCache: Map<string, string>;
  /** 本次请求已消耗的 Exa 调用次数 */
  webCalls: number;
  /** 本次请求的 Exa 累计成本（美元） */
  webCostUsd: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface AIResponse {
mode: 'conversation' | 'recommendation';
// 对话模式
reply?: string;                // 自然语言回复
// 推荐模式
analysis?: string;
readingInsight?: string;             // 阅读洞察（基于书库的深度观察）
recommendationStrategy?: string;     // 推荐策略说明
libraryMatches?: LibraryMatch[];
externalMatches?: ExternalRecommendation[];
suggestedQuestions?: string[];       // 建议的后续问题
/** 服务端对 libraryMatches 的校验统计（非模型产出，由 recommendValidation 附加） */
matchValidation?: MatchValidation;
}

export interface LibraryMatch {
  bookId: string;
  /** 模型给出的书名，服务端用它反查校验 bookId（提示词要求必填，实际可能缺失） */
  title?: string;
  reason: string;
  relevanceScore: number;      // 0-1 相关度评分
  timing?: string;             // 为什么是现在读
  prerequisite?: string | null; // 前置阅读要求
  role?: 'primary' | 'complement' | 'palate_cleanser';  // 三层推荐角色
}

/** 服务端对 libraryMatches 的校验结果，随响应回传给前端展示 */
export interface MatchValidation {
  kept: number;
  repaired: number;
  dropped: number;
  droppedTitles: string[];
  /** 与书库同名的站外推荐（提示词禁止但模型仍会犯），已剔除并在此留证 */
  externalDuplicates?: string[];
}

export interface ExternalRecommendation {
  title: string;
  author: string;
  publisher: string;
  reason: string;
  level: BookLevel;
  category?: string;
  subcategory?: string;
  rating?: number;
  doubanId?: string;
  confidence?: 'high' | 'medium' | 'low';  // 推荐可信度
  role?: 'primary' | 'complement' | 'palate_cleanser';  // 三层推荐角色
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

export interface SearchBooksRequest {
  query: string;
  category?: string;
  level?: BookLevel;
  status?: BookStatus;
  limit?: number;
}

export interface AIRecommendRequest {
  userRequest: string;
  category?: string;       // 可选：限制在特定分类
  includeExternal?: boolean;  // 是否包含外部推荐
  maxResults?: number;
}

export interface BatchAnalyzeRequest {
  titles: string[];
  existingCategories?: string[];
}

export interface DoubanSearchRequest {
  q: string;
  count?: number;
}

// ============================================================================
// 阅读路径规划类型
// ============================================================================

export interface ReadingPathRequest {
  category: string;
  subcategory?: string;
  customRequirements?: string;
  bookIds: string[];  // 要规划的书籍ID列表
}

export interface ReadingPathResponse {
  sortedBookIds: string[];
  reasoning: string;
  estimatedTotalDays?: number;
  pathStages: PathStage[];
}

export interface PathStage {
  stage: number;
  bookIds: string[];
  theme: string;  // 该阶段的学习主题
  description: string;
}

// ============================================================================
// 错误类型
// ============================================================================

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export enum ErrorCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  BOOK_NOT_FOUND = 'BOOK_NOT_FOUND',
  AI_SERVICE_ERROR = 'AI_SERVICE_ERROR',
  DOUBAN_API_ERROR = 'DOUBAN_API_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}
