/**
 * 轻量级 Markdown 渲染器
 *
 * 不依赖外部库，支持：
 * - 标题 (h1-h3)
 * - 粗体 / 斜体
 * - 行内代码 / 代码块
 * - 无序列表 / 有序列表
 * - 引用
 * - 段落
 * - 链接
 */

import React from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * 解析行内格式：粗体、斜体、行内代码、链接
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // 正则：**bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    // 前面的普通文本
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      nodes.push(<strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-slate-900 dark:text-slate-100">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      nodes.push(<em key={`${keyPrefix}-i-${idx}`} className="italic">{match[3]}</em>);
    } else if (match[4]) {
      // `code`
      nodes.push(<code key={`${keyPrefix}-c-${idx}`} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-pink-600 dark:text-pink-400 text-sm font-mono">{match[4]}</code>);
    } else if (match[5] && match[6]) {
      // [text](url)
      nodes.push(<a key={`${keyPrefix}-a-${idx}`} href={match[6]} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">{match[5]}</a>);
    }

    lastIndex = regex.lastIndex;
    idx++;
  }

  // 剩余文本
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content, className = '' }) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  let keyIdx = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 代码块
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={`pre-${keyIdx++}`} className="my-2 p-3 rounded-lg bg-slate-900 dark:bg-slate-950 text-slate-100 text-sm overflow-x-auto">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // 标题
    const h3Match = line.match(/^###\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h1Match = line.match(/^#\s+(.+)/);
    if (h3Match) {
      elements.push(<h3 key={`h3-${keyIdx++}`} className="text-base font-semibold mt-3 mb-1 text-slate-800 dark:text-slate-200">{renderInline(h3Match[1], `h3-${keyIdx}`)}</h3>);
      i++;
      continue;
    }
    if (h2Match) {
      elements.push(<h2 key={`h2-${keyIdx++}`} className="text-lg font-semibold mt-4 mb-2 text-slate-800 dark:text-slate-200">{renderInline(h2Match[1], `h2-${keyIdx}`)}</h2>);
      i++;
      continue;
    }
    if (h1Match) {
      elements.push(<h1 key={`h1-${keyIdx++}`} className="text-xl font-bold mt-4 mb-2 text-slate-900 dark:text-slate-100">{renderInline(h1Match[1], `h1-${keyIdx}`)}</h1>);
      i++;
      continue;
    }

    // 引用
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${keyIdx++}`} className="my-2 pl-3 border-l-3 border-blue-400 dark:border-blue-600 text-slate-600 dark:text-slate-400 italic">
          {renderInline(quoteLines.join(' '), `bq-${keyIdx}`)}
        </blockquote>
      );
      continue;
    }

    // 无序列表
    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${keyIdx++}`} className="my-1.5 space-y-1 pl-1">
          {items.map((item, idx) => (
            <li key={`li-${keyIdx}-${idx}`} className="flex gap-2 text-slate-700 dark:text-slate-300">
              <span className="text-blue-500 mt-0.5 shrink-0">•</span>
              <span>{renderInline(item, `li-${keyIdx}-${idx}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // 有序列表
    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${keyIdx++}`} className="my-1.5 space-y-1 pl-1">
          {items.map((item, idx) => (
            <li key={`oli-${keyIdx}-${idx}`} className="flex gap-2 text-slate-700 dark:text-slate-300">
              <span className="text-blue-500 font-medium shrink-0">{idx + 1}.</span>
              <span>{renderInline(item, `oli-${keyIdx}-${idx}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 分割线
    if (line.match(/^---+$/)) {
      elements.push(<hr key={`hr-${keyIdx++}`} className="my-3 border-slate-200 dark:border-slate-700" />);
      i++;
      continue;
    }

    // 普通段落
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^#{1,3}\s/) && !lines[i].match(/^[-*]\s/) && !lines[i].match(/^\d+\.\s/) && !lines[i].startsWith('> ') && !lines[i].trim().startsWith('```') && !lines[i].match(/^---+$/)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={`p-${keyIdx++}`} className="my-1.5 text-slate-700 dark:text-slate-300 leading-relaxed">
          {renderInline(paraLines.join(' '), `p-${keyIdx}`)}
        </p>
      );
    }
  }

  return <div className={className}>{elements}</div>;
});
MarkdownRenderer.displayName = 'MarkdownRenderer';
