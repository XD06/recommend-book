/**
 * 阅读洞察 Prompt
 * 根据用户整体阅读数据生成个性化分析和建议
 */

export const READING_INSIGHTS_SYSTEM_PROMPT = `你是一位贴心的阅读分析师，擅长从用户的阅读数据中发现模式、问题并提出有建设性的建议。

你的任务：
- 分析用户的阅读习惯、偏好、进度，给出洞察
- 语气温暖、鼓励，像一个关心用户阅读的朋友
- 避免空洞的套话，给出具体的、可操作的建议

输出 JSON 格式：
{
  "overallAnalysis": "整体阅读状态分析（2-3句话）",
  "strengths": ["阅读优点1", "阅读优点2"],
  "suggestions": ["具体建议1", "具体建议2", "具体建议3"],
  "nextReadHint": "下一本推荐方向（基于当前阅读模式）"
}`;

export function buildReadingInsightsUserPrompt(data: {
  totalBooks: number;
  readingCount: number;
  finishedCount: number;
  unreadCount: number;
  totalPagesRead: number;
  avgRating: number;
  categoryDistribution: Array<{ category: string; count: number }>;
  levelDistribution: { Basic: number; Advanced: number; Expert: number };
  readingBooks: Array<{ title: string; author: string; progress: number; category: string }>;
  finishedBooks: Array<{ title: string; author: string; category: string }>;
}): string {
  let prompt = '请根据以下阅读数据生成个性化洞察：\n\n';

  prompt += '--- 整体统计 ---\n';
  prompt += `藏书总数：${data.totalBooks}\n`;
  prompt += `正在阅读：${data.readingCount} 本\n`;
  prompt += `已读完：${data.finishedCount} 本\n`;
  prompt += `未读：${data.unreadCount} 本\n`;
  prompt += `累计阅读页数：${data.totalPagesRead}\n`;
  prompt += `平均评分：${data.avgRating.toFixed(1)}\n\n`;

  prompt += '--- 分类分布 ---\n';
  for (const cat of data.categoryDistribution.slice(0, 10)) {
    prompt += `${cat.category}：${cat.count} 本\n`;
  }

  prompt += '\n--- 难度分布 ---\n';
  prompt += `入门：${data.levelDistribution.Basic} 本\n`;
  prompt += `进阶：${data.levelDistribution.Advanced} 本\n`;
  prompt += `专家：${data.levelDistribution.Expert} 本\n\n`;

  if (data.readingBooks.length > 0) {
    prompt += '--- 正在阅读 ---\n';
    for (const b of data.readingBooks) {
      prompt += `《${b.title}》(${b.author}) - ${b.category} - 进度 ${b.progress.toFixed(0)}%\n`;
    }
    prompt += '\n';
  }

  if (data.finishedBooks.length > 0) {
    prompt += '--- 已读书籍 ---\n';
    for (const b of data.finishedBooks.slice(0, 10)) {
      prompt += `《${b.title}》(${b.author}) - ${b.category}\n`;
    }
  }

  return prompt;
}
