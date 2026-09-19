/**
 * 书库统计的唯一口径实现。
 *
 * 前端统计页通过 GET /api/profile/stats 消费同一函数，避免"页面数字"与
 * "发给模型的概览数字"各算一套。修改这里的定义时两边会同步生效。
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
  rating: { count: number; avg: number };
  /** 按藏书数降序 */
  byCategory: LibraryCategoryStat[];
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
  let ratingSum = 0;
  let ratingCount = 0;

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

    if (b.rating) {
      ratingSum += b.rating;
      ratingCount++;
    }

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
    rating: { count: ratingCount, avg: ratingCount > 0 ? ratingSum / ratingCount : 0 },
    byCategory,
  };
}

/** 概览用的单行分类分布，如 `编程(12本: 在读3,已读7,未读2)` */
export function formatCategoryDistribution(stats: LibraryStats): string {
  return stats.byCategory
    .map(c => `${c.name}(${c.total}本: 在读${c.reading},已读${c.finished},未读${c.unread})`)
    .join('、');
}
