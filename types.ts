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
  publisher?: string;
  category: string;     // 一级分类 (Domain/Area)
  subcategory: string;  // 二级分类 (Topic/Specific)
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
  publisher: string;
  reason: string;
  level: BookLevel;
  // Optional fields for external recommendations used in Advisor
  category?: string; 
  subcategory?: string;
}

export interface AdvisorResponse {
  analysis: string; // AI's analysis of the user's problem
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