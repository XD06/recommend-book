/**
 * 书籍问答 Prompt
 * 用户就当前阅读的书籍向 AI 提问，AI 结合书籍信息、用户画像、书库上下文给出回答
 */

export const BOOK_QA_SYSTEM_PROMPT = `你是 DeepRead，一位博学且体贴的阅读伴侣，正在陪伴用户阅读一本书。

## 你的角色
- 像一位读过这本书的朋友，用平易近人的语言解答疑问
- 回答要准确、有深度，但避免过于学术化
- 如果用户问的内容超出了书籍范围，可以适当延伸但要点明
- 鼓励用户思考，适时反问引导深入阅读
- 根据用户的阅读进度调整回答深度——进度早期避免剧透，进度后期可以深度讨论

## 回答原则
- 用中文回答
- 回答简洁有力，通常不超过 400 字
- 如果涉及书中具体内容，尽量引用书中的概念或观点
- 如果不确定，坦诚告知
- 当用户进度较低时，侧重于激发兴趣和建立框架
- 当用户进度较高时，侧重于深度理解和批判性思考
- 如果书库中有相关书籍，可以适当建立知识连接（"你在读的《X》也提到了这个概念"）

## 回答结构
1. 直接回答用户的问题
2. 如有必要，补充背景或上下文
3. 如有价值，提出一个引导性思考问题`;

export function buildBookQAContext(
  title: string,
  author: string,
  category?: string,
  subcategory?: string,
  level?: string,
  aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] },
  doubanData?: { summary?: string; rating_score?: number; tags?: string[] },
  readingProgress?: { currentPage: number; totalPages: number; percentage: number },
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  // 系统提示
  let systemContext = BOOK_QA_SYSTEM_PROMPT + '\n\n--- 当前书籍信息 ---\n';
  systemContext += `书名：《${title}》\n`;
  systemContext += `作者：${author}\n`;
  if (category) systemContext += `分类：${category}${subcategory ? ` > ${subcategory}` : ''}\n`;
  if (level) systemContext += `难度：${level}\n`;

  if (aiInsight) {
    systemContext += '\n--- AI 解读摘要 ---\n';
    if (aiInsight.summary) systemContext += `简介：${aiInsight.summary}\n`;
    if (aiInsight.advice) systemContext += `阅读建议：${aiInsight.advice}\n`;
    if (aiInsight.keyChapters && aiInsight.keyChapters.length > 0) {
      systemContext += `核心章节：${aiInsight.keyChapters.join('、')}\n`;
    }
  }

  if (doubanData) {
    systemContext += '\n--- 豆瓣信息 ---\n';
    if (doubanData.summary) systemContext += `内容简介：${doubanData.summary.slice(0, 500)}\n`;
    if (doubanData.rating_score) systemContext += `评分：${doubanData.rating_score}/10\n`;
    if (doubanData.tags && doubanData.tags.length > 0) {
      systemContext += `标签：${doubanData.tags.slice(0, 8).join('、')}\n`;
    }
  }

  if (readingProgress) {
    systemContext += '\n--- 用户阅读进度 ---\n';
    systemContext += `当前页：${readingProgress.currentPage} / ${readingProgress.totalPages}（${readingProgress.percentage.toFixed(0)}%）\n`;
    // 根据进度给出引导
    if (readingProgress.percentage < 25) {
      systemContext += `提示：用户刚开始读这本书，回答时避免剧透后续内容，侧重建立基础理解。\n`;
    } else if (readingProgress.percentage < 75) {
      systemContext += `提示：用户已读过半，可以深入讨论书中概念，适当引用后续内容。\n`;
    } else {
      systemContext += `提示：用户接近读完，可以进行全面深度讨论，包括批判性分析。\n`;
    }
  }

  messages.push({ role: 'system', content: systemContext });

  // 对话历史
  if (conversationHistory) {
    for (const msg of conversationHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  return messages;
}
