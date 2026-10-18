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
  /** 用户自评 1–5 星。存储位置就是这个对象（后端 books.user_data） */
  userRating?: number;
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
  // 评分：两套量纲，别混用（豆瓣 10 分制 vs 用户自评 1–5 星）
  rating?: number;         // 历史遗留：导入期存过豆瓣分（>5 即豆瓣量纲），新数据不写这里
  userRating?: number;     // 用户自评 1–5 星，权威存储是 userData.userRating
  doubanRating?: number;   // 豆瓣评分（10 分制）
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

/** 书籍操作流水（后端 book_activities 表） */
export type ActivityType = 'added' | 'started' | 'finished' | 'deleted';

export interface BookActivity {
  id: number;
  /** 书已删除时为 null，或指向一个已不存在的 id —— 所以标题必须单独带 */
  bookId: string | null;
  bookTitle: string;
  type: ActivityType;
  createdAt: string;
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

/** 画像字段来源：user = 用户自己定的（权威，AI 不得覆盖）；ai = AI 记录/推断的（可修正） */
export type ProfileFieldSource = 'user' | 'ai';

export interface ProfileFieldMeta {
  source: ProfileFieldSource;
  /** 来源渠道：设置页表单 / 对话中明确陈述 */
  via?: 'form' | 'conversation';
  /** 写入依据（用户原话片段），AI 记录时必填 */
  evidence?: string;
  updatedAt?: string;
}

export interface UserProfile {
  nickname?: string;
  readingLevel: ReadingLevel;
  readingGoal?: string;
  preferredCategories: string[];
  dailyReadingTime?: number;
  /** 画像最后更新时间；注入给模型的提示词用它标注画像是否过期 */
  updatedAt?: string;
  /** 逐字段来源元数据（由后端 loadUserProfile 带出） */
  fieldMeta?: Record<string, ProfileFieldMeta>;
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
  confidence?: 'high' | 'medium' | 'low';
  role?: 'primary' | 'complement' | 'palate_cleanser';
}

export interface AdvisorResponse {
mode?: 'conversation' | 'recommendation';
reply?: string;               // 对话模式回复
analysis: string;
readingInsight?: string;
recommendationStrategy?: string;
/** 客户端为本次推荐生成的归组 id，随采纳反馈一起上报（后端不生成） */
requestId?: string;
libraryMatches: {
bookId: string;
/** 模型给出的书名，服务端用它反查校验 bookId */
title?: string;
reason: string;
timing?: string;
prerequisite?: string | null;
relevanceScore?: number;
role?: 'primary' | 'complement' | 'palate_cleanser';
}[];
externalMatches: Recommendation[];
suggestedQuestions?: string[];
/** 服务端校验统计：bookId 对不上书库时被丢弃的条目数与书名 */
matchValidation?: {
kept: number;
repaired: number;
dropped: number;
droppedTitles: string[];
/** 与书库同名的站外推荐（提示词禁止），已被服务端剔除 */
externalDuplicates?: string[];
};
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
 * 把豆瓣原始图片地址转成后端同源代理地址。
 *
 * 为什么必须转：豆瓣图床有防盗链，直连 doubanio.com 会返回 418/403
 * （实测裸 fetch 418 "cdn error 001"，带 UA+Referer 才 200）；而且外部
 * 代理域名会让几百张封面各走一次跨域 DNS/TLS，首屏并发被拖慢。
 * 后端 `/api/douban/cover` 免鉴权、带 UA/Referer、且 `max-age=86400`。
 */
function toCoverProxy(url: string): string {
  // 已经是后端代理形式就不再套一层
  if (url.includes('/douban/cover')) return url;
  const base = (import.meta.env.VITE_API_BASE as string | undefined)
    || 'http://localhost:3001/api';
  return `${base}/douban/cover?url=${encodeURIComponent(url)}`;
}

/**
 * 获取书籍封面 URL（兼容多种数据格式）
 * 
 * 优先级：
 * 1. coverUrl（代理格式，如 https://douban-proxy.203065.xyz/?url=xxx）
 * 2. doubanData.cover_url（豆瓣原始 URL）
 * 3. doubanData.cover（旧数据兼容）
 *
 * 无论命中哪一档，最终都会收敛到后端同源代理（toCoverProxy）。
 */
export function getBookCoverUrl(book: Book): string | undefined {
  let raw: string | undefined;
  // 1. 优先使用 coverUrl
  if (book.coverUrl) {
    raw = book.coverUrl;
  } else if (book.doubanData?.cover_url) {
    // 2. 使用 doubanData.cover_url
    raw = book.doubanData.cover_url;
  } else if ((book.doubanData as any)?.cover) {
    // 3. 兼容旧数据：doubanData.cover
    raw = (book.doubanData as any).cover;
  }
  if (!raw) return undefined;

  // 外部第三方代理（douban-proxy.xxx/?url=<豆瓣原图>）：抽出内层地址再走本地代理，
  // 否则那个外部服务挂掉就整库封面全裂（历史上正是这么裂的）
  if (raw.includes('douban-proxy') && raw.includes('url=')) {
    try {
      const inner = new URL(raw).searchParams.get('url');
      if (inner) return toCoverProxy(inner);
    } catch {
      // 解析失败就原样用
    }
  }

  return toCoverProxy(raw);
}

/**
 * 检查书籍是否有封面
 */
export function hasBookCover(book: Book): boolean {
  return !!getBookCoverUrl(book);
}
