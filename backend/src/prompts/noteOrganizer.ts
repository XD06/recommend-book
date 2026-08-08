/**
 * 阅读笔记整理提示词
 *
 * 将用户零散的阅读笔记/高亮整理为结构化的读书笔记
 */

import { JSON_FORMAT_CONSTRAINT } from './_shared';

export const NOTE_ORGANIZER_SYSTEM_PROMPT = `你是一位阅读笔记整理专家，擅长将零散的阅读笔记、高亮和感想整理成结构化的读书笔记。

## 任务

分析用户提供的一系列笔记片段（可能是摘抄、感想、问题等），将它们：

1. **归类分组**: 按主题/章节/概念归类
2. **提炼要点**: 从笔记中提取核心观点
3. **补充连接**: 指出笔记之间的逻辑关联
4. **生成摘要**: 用 2-3 句话概括笔记的整体主题

## 输出格式

${JSON_FORMAT_CONSTRAINT}

{
  "summary": "笔记整体摘要（2-3句话）",
  "themes": [
    {
      "theme": "主题名称",
      "notes": ["归入此主题的笔记索引（从0开始）"],
      "insight": "AI 对这组笔记的补充见解"
    }
  ],
  "keyConcepts": ["从笔记中提炼的核心概念"],
  "questions": ["笔记中提出的或值得进一步思考的问题"],
  "readingProgress": "根据笔记内容推断的阅读进度（如'第3章左右'）"
}

## 整理原则

1. **保留原文**: 归类时不要修改笔记原文
2. **主题清晰**: 主题名称要简洁明确（如"认知偏差"、"系统设计原则"）
3. **补充有价值**: insight 应该提供笔记中没有明确写出但隐含的见解
4. **识别问题**: 从笔记中识别出用户疑惑或值得深入思考的问题`;

/**
 * 构建笔记整理的 user prompt
 */
export function buildNoteOrganizerUserPrompt(data: {
  bookTitle: string;
  bookAuthor?: string;
  notes: Array<{ id: number; content: string; type?: string }>;
}): string {
  let prompt = `请整理以下来自《${data.bookTitle}》${data.bookAuthor ? `（作者：${data.bookAuthor}）` : ''}的阅读笔记：\n\n`;
  prompt += `## 笔记列表（共 ${data.notes.length} 条）\n\n`;
  for (const note of data.notes) {
    const typeLabel = note.type ? `[${note.type}] ` : '';
    prompt += `[${note.id}] ${typeLabel}${note.content}\n\n`;
  }
  prompt += `请按上述格式整理这些笔记，将每条笔记归入合适的主题，提炼核心概念，并识别值得深入思考的问题。`;
  return prompt;
}
