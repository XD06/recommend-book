/**
 * 阅读顾问提示词
 * 
 * 核心功能：根据用户心境/需求，从书库中推荐书籍
 * 关键优化：支持分级对话，只在指定分类范围内搜索
 */

import { AIRequestContext, CategoryContext } from '../types';

export const READING_ADVISOR_SYSTEM_PROMPT = `你是 DeepRead，一位智慧的私人阅读顾问（Bibliotherapist）。

## 核心能力

1. **深度理解**: 分析用户的阅读需求、心境状态、学习目标
2. **精准匹配**: 从用户书库中找到最合适的书籍
3. **知识拓展**: 必要时推荐外部优质书籍
4. **对话引导**: 通过提问帮助用户明确需求

## 分析维度

当用户提出请求时，从以下维度分析：

- **情感状态**: 焦虑/迷茫/专注/好奇/振奋/平静
- **学习目标**: 技能提升/认知拓展/问题解决/休闲娱乐
- **时间投入**: 短期速读/深度学习/长期研究
- **难度偏好**: 轻松入门/适度挑战/专业深度

## 匹配策略

### 1. 书库内匹配（优先）

检查用户现有书库中是否有：
- 未读的相关书籍（优先推荐）
- 正在阅读的书籍（提供阅读建议）
- 已读完的书籍（推荐相关延伸）

### 2. 外部推荐（补充）

当书库无法满足时，推荐：
- 该领域经典著作
- 豆瓣评分 8.0+ 的优质书籍
- 与用户需求高度契合的新书

## 输出格式

返回纯 JSON：

{
  "analysis": "对用户需求的分析（100字内，体现同理心）",
  "libraryMatches": [
    {
      "bookId": "书籍ID",
      "reason": "推荐理由（具体说明为什么适合）",
      "relevanceScore": 0.95
    }
  ],
  "externalMatches": [
    {
      "title": "书名",
      "author": "作者",
      "publisher": "出版社",
      "reason": "推荐理由",
      "level": "Basic|Advanced|Expert",
      "category": "建议分类",
      "subcategory": "建议子分类"
    }
  ],
  "suggestedQuestions": [
    "引导用户深入思考的后续问题"
  ]
}

## 分级对话原则

如果提供了分类上下文，请：
1. 优先在该分类范围内搜索
2. 分析该分类下的阅读进度
3. 建议该分类内的阅读路径
4. 如需跨分类推荐，说明理由

## 示例

用户："最近工作压力大，想读点轻松的"

分析：用户处于焦虑状态，需要放松和调节，适合心理学或文学类轻松读物

推荐策略：
1. 优先推荐书库中未读的心理学/文学类入门书籍
2. 避免技术类、学术类书籍
3. 强调阅读的疗愈作用`;

/**
 * 构建分类上下文描述
 */
function buildCategoryContextDescription(context?: CategoryContext): string {
  if (!context) return '';
  
  let description = `\n【分类上下文】\n`;
  description += `当前分类: ${context.currentCategory}\n`;
  
  if (context.parentCategories.length > 0) {
    description += `父级分类: ${context.parentCategories.join(' > ')}\n`;
  }
  
  if (context.subCategories.length > 0) {
    description += `子分类: ${context.subCategories.join(', ')}\n`;
  }
  
  description += `\n该分类下共有 ${context.totalBooks} 本书：\n`;
  description += `- 正在阅读: ${context.readingStats.reading} 本\n`;
  description += `- 已读完: ${context.readingStats.finished} 本\n`;
  description += `- 未开始: ${context.readingStats.unread} 本\n`;
  
  if (context.booksInContext.length > 0) {
    description += `\n该分类下的书籍列表：\n`;
    context.booksInContext.forEach((book, index) => {
      description += `${index + 1}. 《${book.title}》- ${book.author} (${book.status})\n`;
      if (book.aiInsight?.summary) {
        description += `   简介: ${book.aiInsight.summary.slice(0, 50)}...\n`;
      }
    });
  }
  
  return description;
}

/**
 * 构建用户提示词
 */
export function buildReadingAdvisorUserPrompt(context: AIRequestContext): string {
  const { userRequest, userMood, categoryContext, library } = context;
  
  let prompt = `【用户需求】\n${userRequest}\n`;
  
  if (userMood) {
    prompt += `\n【用户心境】\n${userMood}\n`;
  }
  
  // 添加分类上下文（如果指定了分类）
  if (categoryContext) {
    prompt += buildCategoryContextDescription(categoryContext);
  } else {
    // 否则提供完整书库
    prompt += `\n【用户书库】\n共 ${library.length} 本书：\n`;
    library.forEach((book, index) => {
      prompt += `${index + 1}. 《${book.title}》- ${book.author} [${book.category}/${book.subcategory}] (${book.status})\n`;
      if (book.aiInsight?.summary) {
        prompt += `   简介: ${book.aiInsight.summary.slice(0, 60)}...\n`;
      }
    });
  }
  
  prompt += `\n请根据以上信息，为用户提供个性化的阅读建议。`;
  
  return prompt;
}

/**
 * 构建分类专项对话提示词
 * 当用户在特定分类下对话时使用
 */
export function buildCategoryFocusedPrompt(
  category: string,
  subcategory: string | undefined,
  books: any[],
  userQuestion: string
): string {
  let prompt = `【分类专项咨询】\n`;
  prompt += `领域: ${category}${subcategory ? ` > ${subcategory}` : ''}\n\n`;
  
  prompt += `该领域下共有 ${books.length} 本书：\n`;
  books.forEach((book, index) => {
    prompt += `${index + 1}. 《${book.title}》- ${book.author}`;
    prompt += ` (${book.status})`;
    if (book.userData?.progressPercentage) {
      prompt += ` [进度: ${Math.round(book.userData.progressPercentage)}%]`;
    }
    prompt += `\n`;
    if (book.aiInsight?.summary) {
      prompt += `   简介: ${book.aiInsight.summary.slice(0, 80)}...\n`;
    }
  });
  
  prompt += `\n【用户问题】\n${userQuestion}\n`;
  prompt += `\n请基于该领域的书籍，回答用户问题。如需推荐该领域外的书籍，请说明理由。`;
  
  return prompt;
}
