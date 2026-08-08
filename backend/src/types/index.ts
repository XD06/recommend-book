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
  
  // 评分
  rating?: number;         // 用户评分
  doubanRating?: number;   // 豆瓣评分
  
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

export interface UserProfile {
  nickname?: string;
  readingLevel: ReadingLevel;
  readingGoal?: string;
  preferredCategories: string[];
  dailyReadingTime?: number;
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

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface AIResponse {
  analysis: string;
  libraryMatches: LibraryMatch[];
  externalMatches: ExternalRecommendation[];
  suggestedQuestions?: string[];  // 建议的后续问题
}

export interface LibraryMatch {
  bookId: string;
  reason: string;
  relevanceScore: number;  // 0-1 相关度评分
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
