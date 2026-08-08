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

export type ReadingMood =
  | 'focused'
  | 'curious'
  | 'anxious'
  | 'lost'
  | 'inspired'
  | 'calm';

export interface AIInsight {
  summary: string;
  advice: string;
  keyChapters: string[];
}

export interface UserProgress {
  totalPages: number;
  currentPage: number;
  progressPercentage: number;
  startDate?: string;
  completionDate?: string;
}

// ============================================================================
// 豆瓣数据类型
// ============================================================================

export interface DoubanComment {
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
  pubdate?: string;
  publish_year?: string;
  isbn?: string;
  isbn13?: string;
  isbn10?: string;
  pages?: number;
  binding?: string;
  price?: string;
  series?: string;
  cover_url?: string;
  // 评分信息
  rating_score?: number;
  rating_count?: number;
  rating_distribution?: Record<string, number>;
  // 阅读状态统计
  reading_status?: {
    reading: number;
    read: number;
    want_to_read: number;
  };
  summary: string;
  url?: string;
  works_id?: string;
  scraped_at?: string;
  tags?: Array<{ name: string; count: number }>;
  images?: {
    small: string;
    medium: string;
    large: string;
  };
  rating?: {
    average: string;
    numRaters: number;
  };
  comments?: DoubanComment[];
}

// ============================================================================
// 核心书籍类型
// ============================================================================

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher?: string;
  category: string;
  subcategory: string;
  tags?: string[];
  level: BookLevel;
  status: BookStatus;
  userData?: UserProgress;
  aiInsight?: AIInsight;
  coverColor?: string;
  coverUrl?: string;  // 代理格式的封面 URL
  rating?: number;
  doubanRating?: number;
  // 豆瓣数据
  doubanId?: string;
  doubanData?: DoubanBookData;
  isbn?: string;
  pubDate?: string;
  publishYear?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryGroup {
  name: string;
  count: number;
  books: Book[];
}

export interface PathStage {
  stage: number;
  bookIds: string[];
  theme: string;
  description: string;
}

export interface ReadingPathResponse {
  sortedBookIds: string[];
  reasoning: string;
  estimatedTotalDays?: number;
  pathStages: PathStage[];
}

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

export interface CategoryMeta {
  path?: string[];
  pathReasoning?: string;
  lastUpdated?: string;
}

export interface Recommendation {
  title: string;
  author: string;
  publisher: string;
  reason: string;
  level: BookLevel;
  category?: string;
  subcategory?: string;
  rating?: number;
}

export interface AdvisorResponse {
  analysis: string;
  libraryMatches: {
    bookId: string;
    reason: string;
  }[];
  externalMatches: Recommendation[];
}

export interface DebugLogItem {
  id: string;
  timestamp: string;
  action: string;
  request: {
    system?: string;
    user?: string;
  };
  response?: any;
  rawResponse?: string;
  error?: string;
}

export interface MoodOption {
  value: ReadingMood;
  label: string;
  description: string;
  emoji: string;
}

export const MOOD_OPTIONS: MoodOption[] = [
  { value: 'focused', label: '专注', description: '想深入钻研某个主题', emoji: '🎯' },
  { value: 'curious', label: '好奇', description: '想探索全新的知识领域', emoji: '🔍' },
  { value: 'anxious', label: '焦虑', description: '需要一些指引和安慰', emoji: '🌊' },
  { value: 'lost', label: '迷茫', description: '不知道下一步该读什么', emoji: '🧭' },
  { value: 'inspired', label: '振奋', description: '充满动力，想挑战自我', emoji: '⚡' },
  { value: 'calm', label: '平静', description: '想安静地享受阅读时光', emoji: '📖' },
];

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取书籍封面 URL（兼容多种数据格式）
 * 
 * 优先级：
 * 1. coverUrl（代理格式，如 https://douban-proxy.203065.xyz/?url=xxx）
 * 2. doubanData.cover_url（豆瓣原始 URL）
 * 3. doubanData.cover（旧数据兼容）
 */
export function getBookCoverUrl(book: Book): string | undefined {
  // 1. 优先使用 coverUrl（代理格式，避免防盗链）
  if (book.coverUrl) {
    return book.coverUrl;
  }
  // 2. 使用 doubanData.cover_url
  if (book.doubanData?.cover_url) {
    return book.doubanData.cover_url;
  }
  // 3. 兼容旧数据：doubanData.cover
  if ((book.doubanData as any)?.cover) {
    return (book.doubanData as any).cover;
  }
  return undefined;
}

/**
 * 检查书籍是否有封面
 */
export function hasBookCover(book: Book): boolean {
  return !!getBookCoverUrl(book);
}
