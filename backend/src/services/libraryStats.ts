/**
 * 书库统计的唯一口径实现。
 *
 * 前端统计页通过 GET /api/profile/stats 消费同一函数，避免"页面数字"与"发给模型的概览数字"各算一套。
 * 修改这里的定义时两边会同步生效。
 */

import { Book, BookLevel, BookStatus } from '../types';

export interface LibraryCategoryStat {
  name: string;
  total: number;
  reading: number;
  finished: number;
  unread: number;
}

export interface LibraryStats {
  totals: { total: number; reading: number; finished: number; unread: number };
  pages: { read: number; planned: number };
  levels: Record<BookLevel, number>;
  /** 豆瓣评分（10 分制）—— 随书目导入的客观数据 */
  doubanRating: { count: number; avg: number };
  /** 用户自评（1–5 星）—— 只有这个能当"用户评价倾向"用 */
  userRating: { count: number; avg: number };
  /** 按藏书数降序 */
  byCategory: LibraryCategoryStat[];
}

/**
 * 用户自评星级的唯一取值口径。
 *
 * 历史坑：导入期把豆瓣分（10 分制，实测均值 8.43）写进了 `books.rating`，
 * 而 `rating` 的语义本该是用户自评 1–5。混着算的后果是品味画像输出
 * "评价偏高，可能比较宽容或只选好书"——一个凭空捏造的人格判断
 * （该用户其实只亲手评过 2 本）。所以这里按量纲分流：
 *   · 显式 userRating（存 user_data.userRating）优先；
 *   · 旧数据里 rating ∈ [1,5] 视为用户自评；
 *   · rating > 5 一律归豆瓣。
 */
export function resolveUserRating(b: Book): number | undefined {
  const own = b.userRating;
  if (typeof own === 'number' && own >= 1 && own <= 5) return own;
  const legacy = b.rating;
  if (typeof legacy === 'number' && legacy >= 1 && legacy <= 5) return legacy;
  return undefined;
}

/** 豆瓣评分的唯一取值口径；优先 douban_data，其次旧的 rating 残留（>5 才认） */
export function resolveDoubanRating(b: Book): number | undefined {
  if (typeof b.doubanRating === 'number' && b.doubanRating > 0) return b.doubanRating;
  const fromDouban = b.doubanData?.rating_score;
  if (typeof fromDouban === 'number' && fromDouban > 0) return fromDouban;
  const legacy = b.rating;
  if (typeof legacy === 'number' && legacy > 5) return legacy;
  return undefined;
}

export function computeLibraryStats(library: Book[]): LibraryStats {
  const totals = { total: library.length, reading: 0, finished: 0, unread: 0 };
  const levels: Record<BookLevel, number> = {
    [BookLevel.BASIC]: 0,
    [BookLevel.ADVANCED]: 0,
    [BookLevel.EXPERT]: 0,
  };
  const categoryMap = new Map<string, LibraryCategoryStat>();

  let pagesRead = 0;
  let pagesPlanned = 0;
  let doubanSum = 0;
  let doubanCount = 0;
  let userSum = 0;
  let userCount = 0;

  for (const b of library) {
    if (b.status === BookStatus.READING) totals.reading++;
    else if (b.status === BookStatus.FINISHED) totals.finished++;
    else totals.unread++;

    if (levels[b.level] !== undefined) levels[b.level]++;

    if (b.userData) {
      pagesPlanned += b.userData.totalPages || 0;
      pagesRead += b.status === BookStatus.FINISHED
        ? (b.userData.totalPages || 0)
        : (b.userData.currentPage || 0);
    }

    const douban = resolveDoubanRating(b);
    if (douban !== undefined) { doubanSum += douban; doubanCount++; }

    const own = resolveUserRating(b);
    if (own !== undefined) { userSum += own; userCount++; }

    let cat = categoryMap.get(b.category);
    if (!cat) {
      cat = { name: b.category, total: 0, reading: 0, finished: 0, unread: 0 };
      categoryMap.set(b.category, cat);
    }
    cat.total++;
    if (b.status === BookStatus.READING) cat.reading++;
    else if (b.status === BookStatus.FINISHED) cat.finished++;
    else cat.unread++;
  }

  const byCategory = [...categoryMap.values()].sort((a, b) => b.total - a.total);

  return {
    totals,
    pages: { read: pagesRead, planned: pagesPlanned },
    levels,
    doubanRating: { count: doubanCount, avg: doubanCount > 0 ? doubanSum / doubanCount : 0 },
    userRating: { count: userCount, avg: userCount > 0 ? userSum / userCount : 0 },
    byCategory,
  };
}

/** 概览用的单行分类分布，如 `编程(12本: 在读3,已读7,未读2)` */
export function formatCategoryDistribution(stats: LibraryStats): string {
  return stats.byCategory
    .map(c => `${c.name}(${c.total}本: 在读${c.reading},已读${c.finished},未读${c.unread})`)
    .join('、');
}
