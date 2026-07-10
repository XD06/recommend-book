/**
 * AI 服务 - 前端版本
 * 
 * 调用后端 API 进行 AI 操作
 */

import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation, AdvisorResponse } from "../types";
import { v4 as uuidv4 } from 'uuid';

const API_BASE = 'http://localhost:3001/api';

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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      library,
      context,
      mood: 'focused',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '推荐失败');
  }

  return await response.json();
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ books, category, subcategory, customRequirements }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '规划路径失败');
  }

  return await response.json();
}

/**
 * 智能整理书库（调用后端 API）
 */
export async function reorganizeLibrary(
  books: Book[]
): Promise<Record<string, { category: string; subcategory: string; tags?: string[] }>> {
  const response = await fetch(`${API_BASE}/ai/reorganize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ books }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '整理失败');
  }

  return await response.json();
}

/**
 * 搜索豆瓣书籍（调用后端 API）
 */
export async function searchDoubanBooks(query: string): Promise<any[]> {
  const response = await fetch(`${API_BASE}/douban/search?q=${encodeURIComponent(query)}`);

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
    headers: { 'Content-Type': 'application/json' },
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
