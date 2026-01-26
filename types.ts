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

export interface Book {
  id: string;
  title: string;
  author: string;
  publisher?: string; // 新增出版社字段
  category: string;
  level: BookLevel;
  status: BookStatus;
  userData?: UserProgress;
  aiInsight?: AIInsight;
}

export interface CategoryGroup {
  name: string;
  count: number;
  books: Book[];
}

export interface ReadingPathResponse {
  sortedBookIds: string[];
  reasoning: string;
}

export interface CategoryMeta {
  path?: string[];      // 存储排序后的 ID 列表
  pathReasoning?: string; // 存储 AI 给出的理由
  lastUpdated?: string;   // 最后更新时间
}

export interface Recommendation {
  title: string;
  author: string;
  publisher: string; // 新增：推荐的具体版本/出版社/译者
  reason: string;
  level: BookLevel;
}