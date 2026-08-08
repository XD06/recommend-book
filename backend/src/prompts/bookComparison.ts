/**
 * 书籍对比 Prompt
 * AI 对比两本或多本书的深度差异，帮助用户选择
 */

export const BOOK_COMPARISON_SYSTEM_PROMPT = `你是 DeepRead，一位专业的书籍对比分析师。

你的任务：对比分析多本书籍的异同，帮助用户做出选择或深入理解。

## 对比维度

1. **内容定位**：各书的核心主题、侧重点、目标读者
2. **难度深度**：入门门槛、知识密度、理解难度
3. **风格特色**：写作风格、叙述方式、实战 vs 理论
4. **实用性**：案例丰富度、可操作性、与现实场景的关联
5. **互补性**：各书之间的关系（互补/替代/进阶）
6. **豆瓣评价**：评分对比、口碑差异

## 输出格式

返回纯 JSON，不要包含任何注释或额外文本：

{
  "overallVerdict": "总体对比结论（100字内，直接回答哪本更适合什么场景）",
  "comparisons": [
    {
      "dimension": "对比维度名称",
      "analysis": "该维度下的对比分析（具体说明差异）",
      "winner": "更优的书名（如果各有千秋则填"各有千秋"）"
    }
  ],
  "recommendation": {
    "forBeginner": "适合初学者的书名 + 理由",
    "forDeepDive": "适合深入研究的书名 + 理由",
    "forPractice": "适合实践应用的书名 + 理由"
  },
  "readingOrder": "如果两本都值得读，建议的阅读顺序和理由（如果只需选一本，留空）"
}

## 准确性要求

1. **基于事实**：分析必须基于提供的书籍信息，不要编造内容
2. **具体而非泛泛**：避免"两本都很好"这类废话，要指出具体差异
3. **尊重数据**：如果豆瓣评分有差距，要客观指出
4. **实用性优先**：最终建议要可操作，帮用户做决定`;

/**
 * 构建书籍对比的用户 prompt
 */
export function buildBookComparisonUserPrompt(
  books: Array<{
    title: string;
    author: string;
    level?: string;
    category?: string;
    subcategory?: string;
    totalPages?: number;
    aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
    doubanData?: {
      rating_score?: number;
      rating_count?: number;
      summary?: string;
      tags?: string[];
      publisher?: string;
      pubdate?: string;
    };
    status?: string;
    progress?: number;
  }>
): string {
  let prompt = `请对比以下 ${books.length} 本书：\n\n`;

  books.forEach((book, i) => {
    prompt += `--- 书籍 ${i + 1} ---\n`;
    prompt += `书名：《${book.title}》\n`;
    prompt += `作者：${book.author}\n`;
    if (book.level) prompt += `难度：${book.level}\n`;
    if (book.category) prompt += `分类：${book.category}${book.subcategory ? ` > ${book.subcategory}` : ''}\n`;
    if (book.totalPages) prompt += `页数：${book.totalPages}\n`;
    if (book.status) {
      const statusMap: Record<string, string> = { reading: '正在阅读', finished: '已读完', unread: '未读' };
      prompt += `阅读状态：${statusMap[book.status] || book.status}`;
      if (book.progress) prompt += `（进度 ${book.progress}%）`;
      prompt += `\n`;
    }

    if (book.aiInsight) {
      prompt += `\nAI 解读：\n`;
      if (book.aiInsight.summary) prompt += `  摘要：${book.aiInsight.summary}\n`;
      if (book.aiInsight.advice) prompt += `  建议：${book.aiInsight.advice}\n`;
      if (book.aiInsight.keyChapters?.length) {
        prompt += `  核心章节：${book.aiInsight.keyChapters.join('、')}\n`;
      }
    }

    if (book.doubanData) {
      prompt += `\n豆瓣信息：\n`;
      if (book.doubanData.rating_score) {
        prompt += `  评分：${book.doubanData.rating_score}/10`;
        if (book.doubanData.rating_count) prompt += `（${book.doubanData.rating_count} 人评价）`;
        prompt += `\n`;
      }
      if (book.doubanData.publisher) prompt += `  出版社：${book.doubanData.publisher}\n`;
      if (book.doubanData.pubdate) prompt += `  出版日期：${book.doubanData.pubdate}\n`;
      if (book.doubanData.summary) {
        const summary = book.doubanData.summary.length > 400
          ? book.doubanData.summary.substring(0, 400) + '...'
          : book.doubanData.summary;
        prompt += `  内容简介：${summary}\n`;
      }
      if (book.doubanData.tags?.length) {
        prompt += `  标签：${book.doubanData.tags.slice(0, 8).join(', ')}\n`;
      }
    }
    prompt += `\n`;
  });

  prompt += `请从多个维度对比这些书籍，给出具体的分析结论和推荐建议。`;
  return prompt;
}
