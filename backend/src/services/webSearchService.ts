/**
 * Exa Web 搜索服务
 *
 * 封装 Exa Search API，为 AI Agent 提供互联网实时搜索能力。
 *
 * 设计原则：
 * - 预设 5 个专业搜索模式（域名限定），确保结果精准可信
 * - 使用 highlights（10x token 效率），降低 LLM 上下文消耗
 * - LRU 缓存避免重复搜索（30 分钟 / 1 小时）
 * - 优雅降级：API Key 未配置时完全隐藏工具
 * - 成本控制：默认 5 条结果，限制 fetch 字符数
 * - 健壮性：独立超时(15s) + 单次会话调用上限(5次) + 成本汇总日志
 *
 * Exa API 文档: https://exa.ai/docs/reference/search
 */

// ============================================================================
// 配置
// ============================================================================

const EXA_API_URL = 'https://api.exa.ai/search';
const EXA_CONTENTS_URL = 'https://api.exa.ai/contents';

/** Exa API 独立超时（毫秒）— 不受 AI_TIMEOUT_MS 影响 */
const EXA_TIMEOUT_MS = 15000;

/** 单次会话最大 Web 工具调用次数（防止 AI 滥用） */
const MAX_WEB_CALLS_PER_SESSION = 5;

/** 获取 Exa API Key（运行时判断，确保 dotenv 已加载） */
export function getExaApiKey(): string | undefined {
  return process.env.EXA_API_KEY?.trim() || undefined;
}

/** 判断是否启用了 Web 搜索 */
export function isWebSearchEnabled(): boolean {
  return !!getExaApiKey();
}

// ============================================================================
// 会话级调用计数 + 成本汇总
// ============================================================================

let sessionCallCount = 0;
let sessionTotalCost = 0;

/** 重置会话计数（每次新请求时由 clearWebCache 触发） */
function resetSessionStats() {
  if (sessionCallCount > 0 || sessionTotalCost > 0) {
    console.log(`[Exa] 会话统计: ${sessionCallCount} 次调用, 总成本 $${sessionTotalCost.toFixed(4)}`);
  }
  sessionCallCount = 0;
  sessionTotalCost = 0;
}

/** 记录一次调用和成本 */
function recordCall(cost?: number) {
  sessionCallCount++;
  if (cost && cost > 0) {
    sessionTotalCost += cost;
  }
}

/** 检查是否超出会话调用上限 */
function isSessionLimitReached(): boolean {
  return sessionCallCount >= MAX_WEB_CALLS_PER_SESSION;
}

// ============================================================================
// 搜索模式预设 — 针对书籍/学习/成长场景的域名限定
// ============================================================================

export type SearchCategory =
  | 'book_reviews'
  | 'book_recommendations'
  | 'academic_research'
  | 'learning_resources'
  | 'author_info'
  | 'general';

interface SearchPreset {
  /** Exa category 参数（undefined 表示不限制） */
  exaCategory?: string;
  /** 限定搜索域名 */
  includeDomains?: string[];
  /** 排除域名 */
  excludeDomains?: string[];
  /** 搜索行为提示 */
  hint: string;
}

const SEARCH_PRESETS: Record<SearchCategory, SearchPreset> = {
  /** 书评与评分 — 豆瓣、Goodreads、Amazon */
  book_reviews: {
    includeDomains: ['douban.com', 'goodreads.com', 'amazon.com'],
    hint: '查找书籍评分、读者评价和书评',
  },
  /** 书籍推荐书单 — 豆瓣、知乎、Goodreads */
  book_recommendations: {
    includeDomains: ['douban.com', 'zhihu.com', 'goodreads.com'],
    hint: '查找书籍推荐书单和领域必读书目',
  },
  /** 学术研究 — Google Scholar、arXiv、SSRN */
  academic_research: {
    exaCategory: 'research paper',
    includeDomains: ['scholar.google.com', 'arxiv.org', 'semanticscholar.org', 'researchgate.net', 'ssrn.com'],
    hint: '查找学术论文和前沿研究',
  },
  /** 学习资源 — 在线课程平台 */
  learning_resources: {
    includeDomains: ['coursera.org', 'edx.org', 'udemy.com', 'khanacademy.org', 'mooc.cn', 'bilibili.com'],
    hint: '查找在线课程和学习路径',
  },
  /** 作者信息 — 维基百科、百度百科 */
  author_info: {
    includeDomains: ['wikipedia.org', 'baike.baidu.com'],
    hint: '查找作者背景和书籍背景信息',
  },
  /** 通用搜索 — 不限域名 */
  general: {
    excludeDomains: ['pinterest.com', 'tiktok.com', 'instagram.com'],
    hint: '通用网络搜索',
  },
};

// ============================================================================
// 工具定义（OpenAI function-calling 格式）
// ============================================================================

export const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: `搜索互联网获取实时信息，如最新书籍推荐、书评评分、学习资源、作者背景、学术研究等。
仅当书库工具无法满足用户需求时使用（如推荐书库中不存在的新书、查询最新评价、了解领域前沿动态）。
慎用：每次调用消耗 API 额度，请选择最合适的 category 以获得精准结果。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询词，使用自然语言描述（如"2024年最佳机器学习入门书籍"）',
        },
        category: {
          type: 'string',
          enum: ['book_reviews', 'book_recommendations', 'academic_research', 'learning_resources', 'author_info', 'general'],
          description: '搜索类型，决定搜索哪些专业网站。book_reviews=书评评分, book_recommendations=推荐书单, academic_research=学术论文, learning_resources=在线课程, author_info=作者背景, general=通用搜索',
        },
        searchType: {
          type: 'string',
          enum: ['auto', 'fast', 'deep'],
          description: '搜索深度。auto=默认平衡(~1秒), fast=快速(~450ms), deep=深度推理(4-15秒,适合复杂查询)。默认 auto。',
        },
        numResults: {
          type: 'number',
          description: '返回结果数量，默认5，最大10',
        },
      },
      required: ['query'],
    },
  },
};

export const WEB_FETCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_fetch',
    description: `获取指定 URL 的网页详细内容（markdown 格式）。
仅当 web_search 返回的摘要不够详细时使用，用于深入阅读具体页面内容。
慎用：每次调用消耗 API 额度，最多获取 3 个 URL。`,
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: '要获取内容的 URL 列表（最多3个）',
        },
        maxCharacters: {
          type: 'number',
          description: '每个页面最大字符数，默认5000',
        },
      },
      required: ['urls'],
    },
  },
};

/** 所有 Web 工具定义 */
export const WEB_TOOLS = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

// ============================================================================
// 独立的 Web 缓存 — 与书库工具缓存分离，TTL 不同
// ============================================================================

interface CacheEntry {
  result: string;
  timestamp: number;
}

const webCache = new Map<string, CacheEntry>();
const WEB_CACHE_MAX = 30;
const SEARCH_TTL_MS = 30 * 60 * 1000;   // 30 分钟
const FETCH_TTL_MS = 60 * 60 * 1000;    // 1 小时

function getWebCacheKey(toolName: string, args: Record<string, any>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

function getCachedWebResult(toolName: string, args: Record<string, any>, ttlMs: number): string | undefined {
  const key = getWebCacheKey(toolName, args);
  const entry = webCache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.timestamp > ttlMs) {
    webCache.delete(key);
    return undefined;
  }

  // LRU: 移到末尾
  webCache.delete(key);
  webCache.set(key, entry);
  return entry.result;
}

function setCachedWebResult(toolName: string, args: Record<string, any>, result: string): void {
  const key = getWebCacheKey(toolName, args);
  if (webCache.size >= WEB_CACHE_MAX) {
    const firstKey = webCache.keys().next().value;
    if (firstKey) webCache.delete(firstKey);
  }
  webCache.set(key, { result, timestamp: Date.now() });
}

/** 清空 Web 缓存（每次新请求时调用，同时重置会话统计） */
export function clearWebCache(): void {
  webCache.clear();
  resetSessionStats();
}

// ============================================================================
// Exa API 调用
// ============================================================================

interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
  summary?: string;
  text?: string;
}

interface ExaSearchResponse {
  results: ExaSearchResult[];
  requestId?: string;
  costDollars?: { total?: number };
}

/**
 * 带超时的 fetch 封装
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = EXA_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 执行 Web 搜索
 */
async function exaSearch(
  query: string,
  category: SearchCategory = 'general',
  searchType: 'auto' | 'fast' | 'deep' = 'auto',
  numResults: number = 5,
): Promise<ExaSearchResponse> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error('Exa API Key 未配置，无法执行 Web 搜索');
  }

  const preset = SEARCH_PRESETS[category] || SEARCH_PRESETS.general;

  const body: Record<string, any> = {
    query,
    type: searchType,
    numResults: Math.min(numResults, 10),
    contents: {
      highlights: {
        query,             // 让 highlights 聚焦于查询相关的内容
        maxCharacters: 2000, // 每条结果最多 2000 字符的 highlights
      },
      summary: true,       // 让 Exa 生成每条结果的摘要
    },
  };

  // 应用预设
  if (preset.exaCategory) {
    body.category = preset.exaCategory;
  }
  if (preset.includeDomains) {
    body.includeDomains = preset.includeDomains;
  }
  if (preset.excludeDomains) {
    body.excludeDomains = preset.excludeDomains;
  }

  const response = await fetchWithTimeout(EXA_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Exa] Search API error ${response.status}: ${errorText.substring(0, 300)}`);

    // 429 速率限制
    if (response.status === 429) {
      throw new Error('Exa API 速率限制（429），请稍后再试');
    }
    throw new Error(`Exa Search API 失败: ${response.status}`);
  }

  return response.json() as Promise<ExaSearchResponse>;
}

/**
 * 获取网页内容
 */
async function exaContents(
  urls: string[],
  maxCharacters: number = 5000,
): Promise<{ results: ExaSearchResult[] }> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error('Exa API Key 未配置，无法获取网页内容');
  }

  const body: Record<string, any> = {
    urls: urls.slice(0, 3),
    text: {
      maxCharacters,
    },
    highlights: true,
  };

  const response = await fetchWithTimeout(EXA_CONTENTS_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Exa] Contents API error ${response.status}: ${errorText.substring(0, 300)}`);
    throw new Error(`Exa Contents API 失败: ${response.status}`);
  }

  return response.json() as Promise<{ results: ExaSearchResult[] }>;
}

// ============================================================================
// 工具执行器 — 供 Agent 循环调用
// ============================================================================

/**
 * 格式化搜索结果为 AI 友好的 JSON 字符串
 */
function formatSearchResults(
  query: string,
  category: SearchCategory,
  results: ExaSearchResult[],
  costDollars?: number,
): string {
  const preset = SEARCH_PRESETS[category];

  const formatted = {
    query,
    category,
    categoryHint: preset.hint,
    totalResults: results.length,
    results: results.map((r, idx) => ({
      index: idx + 1,
      title: r.title,
      url: r.url,
      author: r.author || undefined,
      publishedDate: r.publishedDate || undefined,
      highlights: r.highlights?.slice(0, 3) || undefined,  // 最多 3 条 highlights
      summary: r.summary || undefined,
    })),
    searchCost: costDollars ? `$${costDollars.toFixed(4)}` : undefined,
    note: '以上是网络搜索结果，请基于这些信息回答用户问题。引用信息时请注明来源。',
  };

  return JSON.stringify(formatted);
}

/**
 * 格式化网页内容为 AI 友好的 JSON 字符串
 */
function formatFetchResults(
  urls: string[],
  results: ExaSearchResult[],
): string {
  const formatted = {
    requestedUrls: urls,
    totalFetched: results.length,
    pages: results.map((r, idx) => ({
      index: idx + 1,
      title: r.title,
      url: r.url,
      highlights: r.highlights?.slice(0, 5) || undefined,
      text: r.text
        ? (r.text.length > 5000 ? r.text.substring(0, 5000) + '...(截断)' : r.text)
        : undefined,
    })),
  };

  return JSON.stringify(formatted);
}

/**
 * 执行 Web 工具调用
 * @param toolName 工具名称（web_search / web_fetch）
 * @param args 工具参数
 * @returns JSON 格式的工具结果字符串
 */
export async function executeWebTool(
  toolName: string,
  args: Record<string, any>,
): Promise<string> {
  try {
    // 会话调用上限检查（缓存命中不计入）
    if (isSessionLimitReached()) {
      console.warn(`[Exa] 会话调用上限已达 ${MAX_WEB_CALLS_PER_SESSION} 次，拒绝请求`);
      return JSON.stringify({
        error: `Web 搜索调用次数已达上限（${MAX_WEB_CALLS_PER_SESSION} 次/会话），请基于已有信息回答用户问题。`,
        hint: '可以综合之前搜索到的结果回答用户，或告知用户网络搜索额度已用完。',
      });
    }

    switch (toolName) {
      case 'web_search': {
        const query: string = args.query;
        const category: SearchCategory = (args.category as SearchCategory) || 'general';
        const searchType: 'auto' | 'fast' | 'deep' = args.searchType || 'auto';
        const numResults: number = args.numResults || 5;

        if (!query || query.trim().length === 0) {
          return JSON.stringify({ error: '搜索查询词不能为空' });
        }

        // 查缓存
        const cacheKey = { query, category, searchType, numResults };
        const cached = getCachedWebResult('web_search', cacheKey, SEARCH_TTL_MS);
        if (cached) {
          console.log(`[Exa] web_search 缓存命中: "${query}"`);
          return cached;
        }

        console.log(`[Exa] web_search: query="${query}", category=${category}, type=${searchType}, num=${numResults}`);
        const startTime = Date.now();

        const response = await exaSearch(query, category, searchType, numResults);
        const elapsed = Date.now() - startTime;
        const cost = response.costDollars?.total;

        // 记录调用和成本
        recordCall(cost);

        console.log(`[Exa] web_search 完成 (${elapsed}ms): ${response.results.length} 条结果, cost=$${cost?.toFixed(4) || '?'}, sessionTotal=${sessionCallCount}/${MAX_WEB_CALLS_PER_SESSION}`);

        const formatted = formatSearchResults(query, category, response.results, cost);

        // 写缓存
        setCachedWebResult('web_search', cacheKey, formatted);

        return formatted;
      }

      case 'web_fetch': {
        const urls: string[] = args.urls || [];
        const maxCharacters: number = args.maxCharacters || 5000;

        if (urls.length === 0) {
          return JSON.stringify({ error: 'URL 列表不能为空' });
        }

        // 限制最多 3 个 URL
        const limitedUrls = urls.slice(0, 3);

        // 查缓存
        const cacheKey = { urls: limitedUrls, maxCharacters };
        const cached = getCachedWebResult('web_fetch', cacheKey, FETCH_TTL_MS);
        if (cached) {
          console.log(`[Exa] web_fetch 缓存命中: ${limitedUrls.length} 个 URL`);
          return cached;
        }

        console.log(`[Exa] web_fetch: ${limitedUrls.length} 个 URL, maxChars=${maxCharacters}`);
        const startTime = Date.now();

        const response = await exaContents(limitedUrls, maxCharacters);
        const elapsed = Date.now() - startTime;

        console.log(`[Exa] web_fetch 完成 (${elapsed}ms): ${response.results.length} 个页面`);

        // 记录调用（fetch 不返回成本，但不计入也不影响统计准确性）
        recordCall();

        const formatted = formatFetchResults(limitedUrls, response.results);

        // 写缓存
        setCachedWebResult('web_fetch', cacheKey, formatted);

        return formatted;
      }

      default:
        return JSON.stringify({ error: `未知的 Web 工具: ${toolName}` });
    }
  } catch (error) {
    const errMsg = (error as Error).message;
    console.error(`[Exa] 工具执行失败 (${toolName}):`, errMsg);
    return JSON.stringify({
      error: `Web 搜索服务暂时不可用: ${errMsg}`,
      hint: '请基于书库中的信息回答用户问题，或告知用户网络搜索暂时不可用。',
    });
  }
}

/**
 * 判断工具名是否为 Web 工具
 */
export function isWebTool(toolName: string): boolean {
  return toolName === 'web_search' || toolName === 'web_fetch';
}

/**
 * 获取 Web 工具的描述（用于 onToolCall 回调）
 */
export function describeWebToolCall(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'web_search': {
      const categoryLabels: Record<string, string> = {
        book_reviews: '书评评分',
        book_recommendations: '推荐书单',
        academic_research: '学术研究',
        learning_resources: '学习资源',
        author_info: '作者信息',
        general: '通用搜索',
      };
      const cat = categoryLabels[args.category] || '通用搜索';
      return `网络搜索「${args.query?.slice(0, 30) || ''}」（${cat}）`;
    }
    case 'web_fetch':
      return `获取网页内容${args.urls ? `（${args.urls.length} 个页面）` : ''}`;
    default:
      return toolName;
  }
}
