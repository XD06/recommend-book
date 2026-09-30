/**
 * 推荐输出的服务端校验
 *
 * 前端渲染"书库匹配"是按 bookId 在书库里找书、找不到就整条不画，所以一个编造的
 * ID 会让"模型推了 3 本"在界面上静默变成"推了 2 本"，用户和开发者都收不到信号。
 * 这里在回给客户端之前把 libraryMatches 逐条对齐真实书库：ID 对得上就保留，
 * 对不上用书名反查修复，修不掉才丢弃，并把三个计数随响应一起回传。
 */

import { Book, MatchValidation } from '../types';

export interface ValidatedAdvisorJson {
  /** 清洗后的 JSON；原输入不可解析时按原样返回 */
  json: string;
  /** 只有真正校验过书库匹配才有值 */
  validation?: MatchValidation;
}

/**
 * 书名归一化，与前端 utils/dedup.ts 的保守策略同口径：
 * 只剥版次/格式标记与空白、统一冒号，不动副标题（否则会把同系列不同册并成一本）。
 */
function normalizeTitle(title: string): string {
  let t = title.toLowerCase().trim();
  const edition =
    /(?:第\d+版|原书第\d+版|修订版|纪念版|珍藏版|百万纪念[^）]*|高清[^）]*|完整[^）]*|新版|彩印|插图版|中译本|中文版|图文版|纪念珍藏[^）]*)/;
  t = t.replace(new RegExp(`（[^）]*${edition.source}[^）]*）`, 'g'), '');
  t = t.replace(new RegExp(`\\([^)]*${edition.source}[^)]*\\)`, 'g'), '');
  t = t.replace(/第\d+版/g, '').replace(/原书第\d+版/g, '');
  t = t.replace(/：/g, ':');
  return t.replace(/\s+/g, '');
}

/** 剥掉书名里的《》与常见前后缀装饰，模型经常带着它们抄书名 */
function stripTitleDecorations(title: string): string {
  return title.replace(/[《》「」『』]/g, '').trim();
}

function findUniqueByTitle(
  wanted: string,
  byTitle: Map<string, Book[]>,
  library: Book[],
): Book | undefined {
  const normalized = normalizeTitle(stripTitleDecorations(wanted));
  if (!normalized) return undefined;

  const exact = byTitle.get(normalized);
  if (exact && exact.length === 1) return exact[0];
  if (exact && exact.length > 1) return undefined; // 同名多本，猜不得

  // 包含式兜底：模型常把副标题截断或多带几个字，唯一命中才敢用
  if (normalized.length >= 4) {
    const partial = library.filter((b) => {
      const bt = normalizeTitle(stripTitleDecorations(b.title));
      return bt.length >= 4 && (bt.includes(normalized) || normalized.includes(bt));
    });
    if (partial.length === 1) return partial[0];
  }
  return undefined;
}

/** 从模型输出里切出第一段 JSON 对象；切不出或解析失败返回 undefined */
function sliceJson(raw: string): any {
  const trimmed = (raw || '').trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return undefined;
  try {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
  } catch {
    return undefined;
  }
}

/**
 * 这份输出是否声称"推荐了用户书库里的书"。
 * 用于书库硬闸门的判据：寒暄回复的 libraryMatches 是空数组，不该被闸门拖去多查一轮。
 */
export function claimsLibraryMatches(raw: string): boolean {
  const parsed = sliceJson(raw);
  return !!parsed && Array.isArray(parsed.libraryMatches) && parsed.libraryMatches.length > 0;
}

/**
 * 校验并清洗模型返回的推荐 JSON。
 *
 * - `libraryMatches` 应当指向书库真实条目：ID 对得上保留，对不上按书名反查修复，
 *   修不掉才丢弃。
 * - `externalMatches` 是站外新书、天然没有 bookId，**但不能因此完全不校验**：
 *   提示词红线第 4 条明写"不要推荐书库中已有的书作为外部推荐"，模型照样会犯
 *   （实测同一次评估里《悉达多》既在 libraryMatches 又在 externalMatches）。
 *   所以至少要用书名归一化查一遍重，命中的直接丢掉。
 */
export function validateAdvisorJson(raw: string, library: Book[]): ValidatedAdvisorJson {
  const parsed = sliceJson(raw);
  if (!parsed || typeof parsed !== 'object') return { json: raw };

  const hasLibraryMatches = Array.isArray(parsed.libraryMatches) && parsed.libraryMatches.length > 0;
  const hasExternalMatches = Array.isArray(parsed.externalMatches) && parsed.externalMatches.length > 0;
  if (!hasLibraryMatches && !hasExternalMatches) return { json: raw };

  // 索引一次建好：libraryMatches 要对齐 ID，externalMatches 要查重
  const byId = new Map<string, Book>();
  const byTitle = new Map<string, Book[]>();
  for (const book of library) {
    byId.set(book.id, book);
    const key = normalizeTitle(stripTitleDecorations(book.title));
    if (!key) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(book);
    else byTitle.set(key, [book]);
  }

  const kept: any[] = [];
  const droppedTitles: string[] = [];
  const externalDuplicates: string[] = [];
  let repaired = 0;

  if (hasLibraryMatches) {
    for (const match of parsed.libraryMatches) {
      if (!match || typeof match !== 'object') {
        droppedTitles.push('(非对象条目)');
        continue;
      }

      const direct = typeof match.bookId === 'string' ? byId.get(match.bookId) : undefined;
      if (direct) {
        kept.push(match);
        continue;
      }

      const title = typeof match.title === 'string' ? match.title : '';
      const fallback = title ? findUniqueByTitle(title, byTitle, library) : undefined;
      if (fallback) {
        match.bookId = fallback.id;
        match.title = fallback.title;
        kept.push(match);
        repaired++;
        continue;
      }

      droppedTitles.push(title || match.bookId || '(无书名无ID)');
    }
    parsed.libraryMatches = kept;
  }

  if (hasExternalMatches) {
    const remaining: any[] = [];
    for (const ext of parsed.externalMatches) {
      if (!ext || typeof ext !== 'object') continue;
      const title = typeof ext.title === 'string' ? ext.title : '';
      const dup = title ? findUniqueByTitle(title, byTitle, library) : undefined;
      if (dup) {
        externalDuplicates.push(dup.title);
        continue;
      }
      remaining.push(ext);
    }
    parsed.externalMatches = remaining;
  }

  const validation: MatchValidation = {
    kept: kept.length,
    repaired,
    dropped: droppedTitles.length,
    droppedTitles,
    externalDuplicates,
  };

  console.log(
    `[AI] 推荐校验: 保留 ${validation.kept} 条（其中按书名修复 ${validation.repaired} 条），丢弃 ${validation.dropped} 条` +
      (droppedTitles.length > 0 ? ` → ${droppedTitles.join('、')}` : '') +
      (externalDuplicates.length > 0 ? `；站外推荐去重 ${externalDuplicates.length} 条 → ${externalDuplicates.join('、')}` : ''),
  );

  parsed.matchValidation = validation;
  return { json: JSON.stringify(parsed), validation };
}
