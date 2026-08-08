/**
 * 书籍去重工具函数
 *
 * 提供标题归一化和多层去重逻辑，供 IngestionWizard 和 App 共享。
 */

/**
 * 标题归一化（保守策略）
 *
 * 只移除版次/格式标记，保留副标题——避免误判不同书籍。
 * 例如：
 *   "深入理解计算机系统 (原书第3版)" → "深入理解计算机系统"
 *   "深入理解计算机系统（原书第2版）" → "深入理解计算机系统"  ✓ 合并
 *   "阅读力：知识读物的阅读策略" → "阅读力:知识读物的阅读策略"
 *   "阅读力：文学作品的阅读策略" → "阅读力:文学作品的阅读策略"  ✗ 不合并（正确）
 */
export function normalizeTitleForDedup(title: string): string {
  let t = title.toLowerCase().trim();

  // 移除括号内的版次/格式信息
  const editionPattern = /(?:第\d+版|原书第\d+版|修订版|纪念版|珍藏版|百万纪念[^）]*|高清[^）]*|完整[^）]*|新版|彩印|插图版|中译本|中文版|图文版|纪念珍藏[^）]*)/;

  t = t.replace(new RegExp(`（[^）]*${editionPattern.source}[^）]*）`, 'g'), '');
  t = t.replace(new RegExp(`\\([^)]*${editionPattern.source}[^)]*\\)`, 'g'), '');

  // 移除独立的版次标记（不在括号内）
  t = t.replace(/第\d+版/g, '');
  t = t.replace(/原书第\d+版/g, '');

  // 统一冒号
  t = t.replace(/：/g, ':');

  // 移除所有空白
  t = t.replace(/\s+/g, '');

  return t.trim();
}

/** 去重结果 */
export interface DedupResult {
  /** 去重后的唯一标题列表 */
  uniqueTitles: string[];
  /** 被去除的重复标题 → 保留的标题 */
  removedMap: Map<string, string>;
  /** 原始总数 */
  originalCount: number;
}

/**
 * 第一层去重：基于归一化标题
 * 同一归一化组内，选择信息最完整的标题（最长的）作为代表
 */
export function deduplicateTitles(titles: string[]): DedupResult {
  const groups = new Map<string, string[]>();

  for (const title of titles) {
    const normalized = normalizeTitleForDedup(title);
    if (!groups.has(normalized)) {
      groups.set(normalized, []);
    }
    groups.get(normalized)!.push(title);
  }

  const uniqueTitles: string[] = [];
  const removedMap = new Map<string, string>();

  for (const [, groupTitles] of groups) {
    const representative = groupTitles.reduce((best, current) =>
      current.length > best.length ? current : best
    );

    uniqueTitles.push(representative);

    for (const title of groupTitles) {
      if (title !== representative) {
        removedMap.set(title, representative);
      }
    }
  }

  return {
    uniqueTitles,
    removedMap,
    originalCount: titles.length,
  };
}

/**
 * 第二层去重：基于豆瓣 ID
 * 不同标题但映射到同一本书的（如副标题翻译不同），通过豆瓣 ID 去重
 */
export function deduplicateByDoubanId<T extends { book: any | null }>(
  results: T[],
): { kept: T[]; removedCount: number } {
  const seenIds = new Map<string, number>();
  const kept: T[] = [];
  let removedCount = 0;

  for (const result of results) {
    if (result.book && result.book.id) {
      const id = String(result.book.id);
      if (seenIds.has(id)) {
        removedCount++;
        continue;
      }
      seenIds.set(id, kept.length);
    }
    kept.push(result);
  }

  return { kept, removedCount };
}

/**
 * 检查单本书是否已存在于书库中
 *
 * 三层匹配策略（任一命中即视为重复）：
 * 1. 豆瓣 ID 匹配（最可靠）
 * 2. ISBN 匹配
 * 3. 归一化标题 + 作者 匹配
 *
 * @param book 待检查的书
 * @param existingBooks 现有书库
 * @returns 匹配到的已有书籍（null 表示不存在）
 */
export function findDuplicateInLibrary<T extends {
  title: string;
  author?: string;
  doubanId?: string;
  isbn?: string;
}>(
  book: T,
  existingBooks: T[],
): T | null {
  const normalizedTitle = normalizeTitleForDedup(book.title);
  const bookAuthor = (book.author || '').toLowerCase().trim();

  for (const existing of existingBooks) {
    // 1. 豆瓣 ID 匹配
    if (book.doubanId && existing.doubanId && book.doubanId === existing.doubanId) {
      return existing;
    }

    // 2. ISBN 匹配
    if (book.isbn && existing.isbn && book.isbn === existing.isbn) {
      return existing;
    }

    // 3. 归一化标题 + 作者匹配
    const existingTitle = normalizeTitleForDedup(existing.title);
    const existingAuthor = (existing.author || '').toLowerCase().trim();

    if (normalizedTitle === existingTitle) {
      // 标题匹配，如果作者也匹配（或一方无作者），视为重复
      if (!bookAuthor || !existingAuthor || bookAuthor === existingAuthor) {
        return existing;
      }
    }
  }

  return null;
}

/**
 * 批量过滤：从新书中移除已存在于书库的书
 *
 * @param newBooks 新导入的书
 * @param existingBooks 现有书库
 * @returns { kept: 不存在于书库的书, duplicates: 被过滤掉的书 }
 */
export function filterDuplicatesFromLibrary<T extends {
  title: string;
  author?: string;
  doubanId?: string;
  isbn?: string;
}>(
  newBooks: T[],
  existingBooks: T[],
): { kept: T[]; duplicates: T[] } {
  // 预构建现有书库的索引（提升大量书籍时的性能）
  const existingByDoubanId = new Map<string, T>();
  const existingByIsbn = new Map<string, T>();
  const existingByNormalizedTitle = new Map<string, T[]>();

  for (const book of existingBooks) {
    if (book.doubanId) {
      existingByDoubanId.set(String(book.doubanId), book);
    }
    if (book.isbn) {
      existingByIsbn.set(book.isbn, book);
    }
    const normalized = normalizeTitleForDedup(book.title);
    if (!existingByNormalizedTitle.has(normalized)) {
      existingByNormalizedTitle.set(normalized, []);
    }
    existingByNormalizedTitle.get(normalized)!.push(book);
  }

  const kept: T[] = [];
  const duplicates: T[] = [];

  for (const newBook of newBooks) {
    let isDuplicate = false;

    // 1. 豆瓣 ID 快速匹配
    if (newBook.doubanId && existingByDoubanId.has(String(newBook.doubanId))) {
      isDuplicate = true;
    }

    // 2. ISBN 快速匹配
    if (!isDuplicate && newBook.isbn && existingByIsbn.has(newBook.isbn)) {
      isDuplicate = true;
    }

    // 3. 归一化标题匹配（+ 作者校验）
    if (!isDuplicate) {
      const normalized = normalizeTitleForDedup(newBook.title);
      const candidates = existingByNormalizedTitle.get(normalized);
      if (candidates && candidates.length > 0) {
        const newAuthor = (newBook.author || '').toLowerCase().trim();
        for (const candidate of candidates) {
          const candidateAuthor = (candidate.author || '').toLowerCase().trim();
          if (!newAuthor || !candidateAuthor || newAuthor === candidateAuthor) {
            isDuplicate = true;
            break;
          }
        }
      }
    }

    if (isDuplicate) {
      duplicates.push(newBook);
    } else {
      kept.push(newBook);
    }
  }

  return { kept, duplicates };
}
