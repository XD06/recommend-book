/**
 * 豆瓣书籍服务 v2
 * 
 * 核心特性：
 * 1. 缓存优先：先查 cache.json → 再实时抓取
 * 2. 集成 douban_mini 抓取器
 * 3. 永久缓存抓取结果
 * 4. 支持代理避免限流
 */

import { DoubanBookData, Comment } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============ 配置 ============
const PROXY_URL = process.env.DOUBAN_PROXY_URL || '';
const CACHE_FILE = path.join(process.cwd(), '..', 'cache.json'); // 项目根目录的 cache.json
const USER_CACHE_FILE = path.join(process.cwd(), 'data', 'user-douban-cache.json'); // 运行时抓取的缓存

// 内存缓存
let memoryCache: Map<string, CachedBook> = new Map();
let preloadedCacheIds: Set<string> = new Set(); // 记录预置缓存的ID
let cacheLoaded = false;

// ============ 类型定义 ============
interface CachedBook {
  book: DoubanBookData;
  comments: Comment[];
  scraped_at: string;
}

interface CacheStructure {
  books: Record<string, CachedBook>;
}

// ============ 缓存管理 ============

/**
 * 加载缓存数据（cache.json + user-douban-cache.json）
 */
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;

  // 1. 加载预置缓存 cache.json
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8');
    const cache: CacheStructure = JSON.parse(data);
    for (const [id, bookData] of Object.entries(cache.books)) {
      memoryCache.set(id, bookData);
      preloadedCacheIds.add(id); // 记录预置缓存ID
    }
    console.log(`[Douban] 已加载 ${preloadedCacheIds.size} 本预置缓存书籍`);
  } catch (error) {
    console.warn('[Douban] 无法加载 cache.json:', (error as Error).message);
  }

  // 2. 加载用户运行时缓存
  try {
    const data = await fs.readFile(USER_CACHE_FILE, 'utf-8');
    const cache: CacheStructure = JSON.parse(data);
    let userCacheCount = 0;
    for (const [id, bookData] of Object.entries(cache.books)) {
      if (!memoryCache.has(id)) {
        memoryCache.set(id, bookData);
        userCacheCount++;
      }
    }
    console.log(`[Douban] 已加载 ${userCacheCount} 本用户缓存书籍`);
  } catch {
    // 文件不存在是正常的，忽略
  }

  cacheLoaded = true;
}

/**
 * 保存用户缓存到文件
 */
async function saveUserCache(): Promise<void> {
  try {
    const userCacheDir = path.dirname(USER_CACHE_FILE);
    await fs.mkdir(userCacheDir, { recursive: true });

    const cache: CacheStructure = { books: {} };
    let userCacheCount = 0;
    
    // 只保存运行时抓取的（不在预置缓存中的）
    for (const [id, data] of memoryCache.entries()) {
      if (!preloadedCacheIds.has(id)) {
        cache.books[id] = data;
        userCacheCount++;
      }
    }

    await fs.writeFile(USER_CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log(`[Douban] 已保存 ${userCacheCount} 本用户缓存到文件`);
  } catch (error) {
    console.error('[Douban] 保存缓存失败:', error);
  }
}

// ============ douban_mini 抓取器集成 ============

/**
 * 调用 Python 抓取器获取书籍详情
 */
async function scrapeBook(doubanId: string): Promise<CachedBook | null> {
  try {
    const { spawn } = await import('child_process');

    // 构建 Python 脚本调用
    const scriptPath = path.join(process.cwd(), '..', 'douban_mini', 'scraper.py');
    
    // 使用 Python 直接调用抓取函数
    const pythonCode = `
import asyncio
import json
import sys
sys.path.insert(0, '${path.dirname(scriptPath).replace(/\\/g, '\\\\')}')
from scraper import DoubanMini

async def main():
    dm = DoubanMini(proxy_url=${PROXY_URL ? `"${PROXY_URL}"` : 'None'}, timeout=15, max_retries=3)
    await dm.start()
    try:
        book = await dm.get_book("${doubanId}")
        if book:
            print(json.dumps(book.to_dict(), ensure_ascii=False))
        else:
            print("null")
    finally:
        await dm.stop()

asyncio.run(main())
`;

    const result = await new Promise<string>((resolve, reject) => {
      const python = spawn('python', ['-c', pythonCode], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      
      let stdout = '';
      let stderr = '';
      
      python.stdout.on('data', (data) => { stdout += data.toString(); });
      python.stderr.on('data', (data) => { stderr += data.toString(); });
      
      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python 进程退出码 ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    if (result === 'null') return null;

    const rawBook = JSON.parse(result);
    
    // 转换为标准格式
    const cachedBook: CachedBook = {
      book: {
        id: rawBook.id,
        title: rawBook.title,
        subtitle: rawBook.subtitle || '',
        original_title: rawBook.original_title || '',
        author: rawBook.author || [],
        translator: rawBook.translator || [],
        publisher: rawBook.publisher || '',
        producer: rawBook.producer || '',
        pubdate: rawBook.publish_year || '',
        isbn: rawBook.isbn || '',
        pages: rawBook.pages || 0,
        binding: rawBook.binding || '',
        price: rawBook.price || '',
        series: rawBook.series || '',
        cover_url: rawBook.cover_url || '',
        rating_score: rawBook.rating_score || 0,
        rating_count: rawBook.rating_count || 0,
        rating_distribution: rawBook.rating_distribution || {},
        summary: rawBook.summary || '',
        reading_status: rawBook.reading_status || { reading: 0, read: 0, want_to_read: 0 },
        url: rawBook.url || `https://book.douban.com/subject/${rawBook.id}/`,
      },
      comments: (rawBook.comments || []).map((c: any) => ({
        user_name: c.user_name,
        rating: c.rating,
        rating_stars: c.rating_stars,
        date: c.date,
        content: c.content,
        votes: c.votes,
      })),
      scraped_at: new Date().toISOString(),
    };

    // 存入缓存
    memoryCache.set(doubanId, cachedBook);
    await saveUserCache();

    return cachedBook;
  } catch (error) {
    console.error(`[Douban] 抓取书籍 ${doubanId} 失败:`, error);
    return null;
  }
}

/**
 * 搜索书籍（使用豆瓣 suggest API）
 * 
 * 策略：
 * 1. 先尝试代理（3次重试）
 * 2. 代理失败则尝试直连（3次重试）
 */
async function searchDouban(keyword: string): Promise<Array<{ id: string; title: string; author: string; year: string; cover_url: string }>> {
  const { default: axios } = await import('axios');
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://book.douban.com/',
    'Accept': 'application/json, text/plain, */*',
  };

  // 代理配置（从环境变量读取，避免硬编码凭据）
  const proxyConfig = PROXY_URL ? (() => {
    try {
      const url = new URL(PROXY_URL);
      return {
        protocol: url.protocol.replace(':', '') as 'http',
        host: url.hostname,
        port: parseInt(url.port, 10),
        auth: url.username ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        } : undefined,
      };
    } catch {
      return undefined;
    }
  })() : undefined;

  // 尝试代理（仅当配置了代理时）
  if (proxyConfig) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[Douban] 搜索尝试 ${attempt}/3 (代理): ${keyword}`);
        const response = await axios.get('https://book.douban.com/j/subject_suggest', {
          params: { q: keyword },
          headers,
          timeout: 10000,
          proxy: proxyConfig,
        });

        const results = response.data;
        if (Array.isArray(results)) {
          console.log(`[Douban] 代理搜索成功，找到 ${results.length} 条结果`);
          return results
            .filter((item: any) => item.type === 'b' || item.type === 'book')
            .map((item: any) => ({
              id: item.id,
              title: item.title,
              author: item.author_name || '',
              year: item.year || '',
              cover_url: item.pic || '',
            }));
        }
      } catch (error: any) {
        console.warn(`[Douban] 代理尝试 ${attempt} 失败:`, error.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt)); // 递增延迟
        }
      }
    }
  } else {
    console.log('[Douban] 未配置代理，直接使用直连');
  }

  // 代理失败，尝试直连（3次重试）
  console.log('[Douban] 代理失败，尝试直连...');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Douban] 搜索尝试 ${attempt}/3 (直连): ${keyword}`);
      const response = await axios.get('https://book.douban.com/j/subject_suggest', {
        params: { q: keyword },
        headers,
        timeout: 10000,
        // 不使用代理
      });

      const results = response.data;
      if (Array.isArray(results)) {
        console.log(`[Douban] 直连搜索成功，找到 ${results.length} 条结果`);
        return results
          .filter((item: any) => item.type === 'b' || item.type === 'book')
          .map((item: any) => ({
            id: item.id,
            title: item.title,
            author: item.author_name || '',
            year: item.year || '',
            cover_url: item.pic || '',
          }));
      }
    } catch (error: any) {
      console.warn(`[Douban] 直连尝试 ${attempt} 失败:`, error.message);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  console.error('[Douban] 所有搜索尝试均失败');
  return [];
}

// ============ 对外接口 ============

/**
 * 搜索书籍（返回搜索结果，不抓取详情）
 */
export async function searchBooks(query: string, count: number = 10): Promise<Array<{ id: string; title: string; author: string; year: string; cover_url: string }>> {
  await loadCache();
  const results = await searchDouban(query);
  return results.slice(0, count);
}

/**
 * 获取书籍详情（缓存优先）
 * 
 * 流程：
 * 1. 先查内存缓存（cache.json + 用户缓存）
 * 2. 没有则实时抓取 → 存入缓存
 */
export async function getBookDetail(doubanId: string): Promise<DoubanBookData | null> {
  await loadCache();

  // 1. 查缓存
  const cached = memoryCache.get(doubanId);
  if (cached) {
    console.log(`[Douban] 缓存命中: ${doubanId}`);
    return cached.book;
  }

  // 2. 实时抓取
  console.log(`[Douban] 缓存未命中，开始抓取: ${doubanId}`);
  const scraped = await scrapeBook(doubanId);
  return scraped?.book || null;
}

/**
 * 批量获取书籍详情
 */
export async function batchGetBookDetails(doubanIds: string[]): Promise<DoubanBookData[]> {
  await loadCache();
  
  const results: DoubanBookData[] = [];
  
  for (const id of doubanIds) {
    const book = await getBookDetail(id);
    if (book) results.push(book);
  }
  
  return results;
}

/**
 * 获取书籍短评（用于 AI 分析）
 */
export async function getBookComments(doubanId: string): Promise<Comment[]> {
  await loadCache();

  // 先查缓存
  const cached = memoryCache.get(doubanId);
  if (cached) {
    return cached.comments;
  }

  // 没有则抓取
  const scraped = await scrapeBook(doubanId);
  return scraped?.comments || [];
}

/**
 * 智能查找书籍（根据书名匹配最佳版本）
 * 
 * 流程：
 * 1. 先查本地缓存（模糊匹配书名）
 * 2. 搜索书名（如果代理可用）
 * 3. 取第一个结果
 * 4. 获取详情（缓存优先）
 */
export async function findBookByTitle(title: string): Promise<{ book: DoubanBookData; comments: Comment[] } | null> {
  await loadCache();

  // 1. 先在本地缓存中模糊匹配
  const normalizedTitle = title.toLowerCase().replace(/[\s:：]/g, '');
  for (const [, cached] of memoryCache.entries()) {
    const cachedTitle = cached.book.title.toLowerCase().replace(/[\s:：]/g, '');
    // 完全匹配或包含关系
    if (cachedTitle === normalizedTitle || 
        cachedTitle.includes(normalizedTitle) || 
        normalizedTitle.includes(cachedTitle)) {
      console.log(`[Douban] 本地缓存模糊匹配成功: ${cached.book.title}`);
      return {
        book: cached.book,
        comments: cached.comments,
      };
    }
  }

  // 2. 搜索（如果代理可用）
  let searchResults;
  try {
    searchResults = await searchDouban(title);
  } catch (error) {
    console.warn('[Douban] 搜索失败，仅使用本地缓存:', (error as Error).message);
    return null;
  }
  
  if (!searchResults || searchResults.length === 0) return null;

  // 3. 取第一个结果（视为最佳匹配）
  const bestMatch = searchResults[0];

  // 4. 获取详情
  let cached = memoryCache.get(bestMatch.id);
  
  if (!cached) {
    console.log(`[Douban] 未缓存，抓取: ${bestMatch.title}`);
    cached = await scrapeBook(bestMatch.id) || undefined;
  } else {
    console.log(`[Douban] 缓存命中: ${bestMatch.title}`);
  }

  if (!cached) return null;

  return {
    book: cached.book,
    comments: cached.comments,
  };
}

/**
 * 获取缓存统计
 */
export function getCacheStats(): { total: number; preloaded: number; userCached: number } {
  const userCached = memoryCache.size - preloadedCacheIds.size;
  return {
    total: memoryCache.size,
    preloaded: preloadedCacheIds.size,
    userCached: Math.max(0, userCached),
  };
}

/**
 * 预加载缓存（启动时调用）
 */
export async function preloadCache(): Promise<void> {
  await loadCache();
}
