/**
 * 读书总结 Prompt
 * 用户读完一本书后，AI 生成个性化阅读总结
 */

export const READING_SUMMARY_SYSTEM_PROMPT = `你是 DeepRead，一位专业的阅读教练。

你的任务：为刚读完一本书的用户生成一份个性化的阅读总结，帮助用户巩固所学、内化知识。

## 总结结构

1. **核心提炼**：用简洁的语言概括这本书的核心价值
2. **知识图谱**：列出书中最关键的 3-5 个概念/知识点
3. **个人感悟提示**：基于用户画像，提出 2-3 个值得深思的问题
4. **行动建议**：读完这本书后，建议用户接下来做什么（可包括实践、延伸阅读等）
5. **一句话回顾**：用一句话概括这本书给用户的最大收获

## 输出格式

返回纯 JSON，不要包含任何注释或额外文本：

{
  "coreValue": "这本书的核心价值概括（50字内）",
  "keyTakeaways": [
    {
      "concept": "概念名称",
      "explanation": "概念解释（结合书中内容，50字内）"
    }
  ],
  "reflectionQuestions": [
    "值得深思的问题1",
    "值得深思的问题2"
  ],
  "actionItems": [
    {
      "type": "practice | read | reflect",
      "description": "具体行动建议"
    }
  ],
  "oneLineSummary": "一句话总结这本书的最大收获"
}

## 个性化要求

1. 如果有用户画像，结合用户的阅读水平、目标和偏好来调整总结的深度
2. 如果有书库信息，推荐用户书库中的相关延伸阅读
3. 如果有用户评分和笔记，融入总结中
4. 行动建议要具体可执行，不要泛泛而谈`;

/**
 * 构建读书总结的用户 prompt
 */
export function buildReadingSummaryUserPrompt(data: {
  title: string;
  author: string;
  category?: string;
  subcategory?: string;
  level?: string;
  totalPages?: number;
  rating?: number;
  aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
  doubanData?: {
    rating_score?: number;
    summary?: string;
    tags?: string[];
  };
  readingProgress?: {
    startDate?: string;
    completionDate?: string;
    totalPages?: number;
  };
  userProfile?: {
    readingLevel?: string;
    readingGoal?: string;
    preferredCategories?: string[];
  };
  relatedBooks?: Array<{ title: string; author: string; category?: string }>;
}): string {
  let prompt = `请为以下已读完的书籍生成个性化阅读总结：\n\n`;

  prompt += `--- 书籍信息 ---\n`;
  prompt += `书名：《${data.title}》\n`;
  prompt += `作者：${data.author}\n`;
  if (data.category) prompt += `分类：${data.category}${data.subcategory ? ` > ${data.subcategory}` : ''}\n`;
  if (data.level) prompt += `难度：${data.level}\n`;
  if (data.totalPages) prompt += `页数：${data.totalPages}\n`;

  if (data.rating) {
    prompt += `用户评分：${data.rating}/5\n`;
  }

  if (data.readingProgress) {
    if (data.readingProgress.startDate) prompt += `开始阅读：${data.readingProgress.startDate}\n`;
    if (data.readingProgress.completionDate) prompt += `完成日期：${data.readingProgress.completionDate}\n`;
    if (data.readingProgress.totalPages) prompt += `阅读页数：${data.readingProgress.totalPages}\n`;
  }

  if (data.aiInsight) {
    prompt += `\n--- AI 解读 ---\n`;
    if (data.aiInsight.summary) prompt += `摘要：${data.aiInsight.summary}\n`;
    if (data.aiInsight.advice) prompt += `建议：${data.aiInsight.advice}\n`;
    if (data.aiInsight.keyChapters?.length) {
      prompt += `核心章节：${data.aiInsight.keyChapters.join('、')}\n`;
    }
  }

  if (data.doubanData) {
    prompt += `\n--- 豆瓣信息 ---\n`;
    if (data.doubanData.rating_score) prompt += `豆瓣评分：${data.doubanData.rating_score}/10\n`;
    if (data.doubanData.summary) {
      const summary = data.doubanData.summary.length > 400
        ? data.doubanData.summary.substring(0, 400) + '...'
        : data.doubanData.summary;
      prompt += `内容简介：${summary}\n`;
    }
    if (data.doubanData.tags?.length) {
      prompt += `标签：${data.doubanData.tags.slice(0, 8).join(', ')}\n`;
    }
  }

  if (data.userProfile) {
    prompt += `\n--- 用户画像 ---\n`;
    if (data.userProfile.readingLevel) prompt += `阅读水平：${data.userProfile.readingLevel}\n`;
    if (data.userProfile.readingGoal) prompt += `阅读目标：${data.userProfile.readingGoal}\n`;
    if (data.userProfile.preferredCategories?.length) {
      prompt += `偏好领域：${data.userProfile.preferredCategories.join('、')}\n`;
    }
  }

  if (data.relatedBooks?.length) {
    prompt += `\n--- 书库中的相关书籍 ---\n`;
    data.relatedBooks.slice(0, 5).forEach(b => {
      prompt += `《${b.title}》- ${b.author}${b.category ? ` [${b.category}]` : ''}\n`;
    });
  }

  prompt += `\n请生成个性化的阅读总结，帮助用户巩固所学。`;
  return prompt;
}
