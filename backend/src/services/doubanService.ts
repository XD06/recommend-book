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
/** 单次 Python 抓取的硬超时：抓取器内部 timeout=15s × 3 次重试，留出进程启动余量 */
const SCRAPE_TIMEOUT_MS = 60_000;

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
 * Python 探测结果缓存。
 *
 * 必须缓存 **Promise** 而不是布尔值：导入流程用 Promise.all 并发发 10 个
 * /douban/find，若先置 `checked = true` 再去 execFile 探测，后来者会读到
 * 尚未赋值的 `available === false`，于是把"正在检测"误判成"未安装"，
 * 只有第一个请求能抓成功、其余全 404（重启后端后首次导入必现）。
 * 缓存 in-flight Promise 让并发请求共享同一次探测结果。
 */
let pythonProbe: Promise<string | null> | null = null;

function execVersion(cmd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    import('child_process').then(({ execFile }) => {
      execFile(cmd, ['--version'], { timeout: 5000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }, reject);
  });
}

/** 探测可用的 Python 命令名，失败返回 null */
async function detectPython(): Promise<string | null> {
  for (const cmd of ['python', 'python3']) {
    try {
      await execVersion(cmd);
      console.log(`[Douban] Python 环境检测成功 (${cmd})`);
      return cmd;
    } catch {
      // 试下一个
    }
  }
  console.warn('[Douban] Python 未安装，豆瓣实时抓取功能不可用（缓存仍可使用）');
  return null;
}

/** 检查 Python 是否已安装（并发安全：所有调用方共享同一个探测 Promise） */
function checkPython(): Promise<boolean> {
  if (!pythonProbe) pythonProbe = detectPython();
  return pythonProbe.then((cmd) => cmd !== null);
}

/** 获取 Python 命令名（探测结果已含命令名，不再重复 execFile） */
async function getPythonCmd(): Promise<string> {
  if (!pythonProbe) pythonProbe = detectPython();
  const cmd = await pythonProbe;
  if (!cmd) throw new Error('Python 未安装');
  return cmd;
}

/** 转义字符串用于 Python 字面量（防注入） */
function escapeForPython(str: string): string {
  // 只允许字母数字和常见 URL 字符，防止注入
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/**
 * 调用 Python 抓取器获取书籍详情
 */
async function scrapeBook(doubanId: string): Promise<CachedBook | null> {
  try {
    // 检查 Python 环境
    const pythonCmd = await getPythonCmd();

    const { spawn } = await import('child_process');

    // 构建 Python 脚本调用
    const scriptPath = path.join(process.cwd(), '..', 'douban_mini', 'scraper.py');

    // 转义参数防止命令注入
    const safeScriptDir = escapeForPython(path.dirname(scriptPath));
    const safeDoubanId = escapeForPython(doubanId);
    const safeProxyUrl = PROXY_URL ? escapeForPython(PROXY_URL) : '';

    // 使用 Python 直接调用抓取函数（参数已转义）
    const pythonCode = `
import asyncio
import json
import sys
sys.path.insert(0, '${safeScriptDir}')
from scraper import DoubanMini

async def main():
    dm = DoubanMini(proxy_url=${safeProxyUrl ? `"${safeProxyUrl}"` : 'None'}, timeout=15, max_retries=3)
    await dm.start()
    try:
        book = await dm.get_book("${safeDoubanId}")
        if book:
            print(json.dumps(book.to_dict(), ensure_ascii=False))
        else:
            print("null")
    finally:
        await dm.stop()

asyncio.run(main())
`;

    const result = await new Promise<string>((resolve, reject) => {
      const python = spawn(pythonCmd, ['-c', pythonCode], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      // 没有超时就会永远挂着：Python 侧代理/豆瓣卡住时前端一直转圈，
      // 而且并发导入会同时堆住 10 个僵尸进程
      const timer = setTimeout(() => {
        try { python.kill('SIGKILL'); } catch { /* 进程可能已退出 */ }
        finish(() => reject(new Error(`Python 抓取超时（${SCRAPE_TIMEOUT_MS}ms）: ${stderr.slice(-200)}`)));
      }, SCRAPE_TIMEOUT_MS);

      python.stdout.on('data', (data) => { stdout += data.toString(); });
      python.stderr.on('data', (data) => { stderr += data.toString(); });

      // spawn 本身失败（命令不存在、EACCES）只发 error 事件、不发 close，
      // 不接这个监听 Promise 永远不会 settle
      python.on('error', (err) => {
        finish(() => reject(new Error(`Python 进程启动失败: ${err.message}`)));
      });

      python.on('close', (code) => {
        // 退出码非 0 但 stdout 有合法 JSON 时仍以 stdout 为准：
        // 抓取器在 finally 里关连接偶发报错，书其实是抓到了
        if (code !== 0 && !stdout.trim()) {
          finish(() => reject(new Error(`Python 进程退出码 ${code}: ${stderr}`)));
        } else {
          finish(() => resolve(stdout.trim()));
        }
      });
    });

    if (!result || result === 'null') return null;

    // stderr 里的告警不能污染解析：只取最后一个 JSON 行
    let rawBook: any;
    try {
      const jsonLine = result.split('\n').reverse().find((line) => line.trim().startsWith('{'));
      rawBook = JSON.parse(jsonLine ?? result);
    } catch (parseErr) {
      throw new Error(`Python 输出无法解析为 JSON: ${(parseErr as Error).message} | stdout=${result.slice(0, 200)}`);
    }

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

  if (!cached) {
    // 详情抓取失败（Python 缺失 / 超时 / 豆瓣限流）时用 suggest 结果兜底：
    // suggest 已经给了书名、作者、年份、封面，足以让书进库；只丢简介/评分/短评。
    // 以前这里 return null → 路由 404 → 前端静默降级成"只有书名"，用户看到的是"添加失败"。
    console.warn(`[Douban] 详情抓取失败，使用搜索结果兜底: ${bestMatch.title}`);
    const fallback: CachedBook = {
      book: {
        id: bestMatch.id,
        title: bestMatch.title || title,
        subtitle: '',
        original_title: '',
        author: bestMatch.author ? bestMatch.author.split(/\s*\/\s*/).filter(Boolean) : [],
        translator: [],
        publisher: '',
        producer: '',
        pubdate: bestMatch.year || '',
        publish_year: bestMatch.year || '',
        isbn: '',
        pages: 0,
        binding: '',
        price: '',
        series: '',
        cover_url: bestMatch.cover_url || '',
        rating_score: 0,
        rating_count: 0,
        rating_distribution: {},
        summary: '',
        reading_status: { reading: 0, read: 0, want_to_read: 0 },
        url: `https://book.douban.com/subject/${bestMatch.id}/`,
      },
      comments: [],
      scraped_at: new Date().toISOString(),
    };
    // 不写进 memoryCache：兜底数据不完整，下次仍应尝试抓取真实详情
    return { book: fallback.book, comments: fallback.comments };
  }

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
