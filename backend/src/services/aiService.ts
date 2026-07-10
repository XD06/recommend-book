/**
 * AI 服务层
 * 
 * 封装 LiteLLM / DeepSeek API 调用，提供：
 * 1. 书籍分类
 * 2. 阅读顾问
 * 3. 书籍解读
 * 4. 阅读路径规划
 */

import OpenAI from 'openai';
import { 
  Book, 
  BookLevel, 
  AIInsight, 
  AIResponse, 
  AIRequestContext,
  CategoryContext,
  ReadingPathResponse,
  ExternalRecommendation 
} from '../types';
import {
  BOOK_CLASSIFIER_SYSTEM_PROMPT,
  buildBookClassifierUserPrompt,
  READING_ADVISOR_SYSTEM_PROMPT,
  buildReadingAdvisorUserPrompt,
  buildCategoryFocusedPrompt,
  INSIGHT_GENERATOR_SYSTEM_PROMPT,
  buildInsightGeneratorUserPrompt
} from '../prompts';

// 获取当前使用的模型
const getModel = () => process.env.LITELLM_MODEL || 'deepseek-chat';

// 判断是否使用 LiteLLM（运行时判断，确保 dotenv 已加载）
const isLiteLLM = () => !!process.env.LITELLM_BASE_URL;

// 初始化 OpenAI 客户端（仅用于 DeepSeek）
const openai = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
});

// LiteLLM 流式 HTTP 调用（非流式请求有兼容性问题，使用流式并收集完整响应）
async function callLiteLLM(body: any): Promise<any> {
  const url = process.env.LITELLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions';
  const apiKey = process.env.LITELLM_API_KEY!;

  // 强制使用流式请求
  const requestBody = {
    ...body,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LiteLLM request failed: ${response.status} ${error}`);
  }

  // 收集流式响应
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;
        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  // 返回类似 OpenAI 的响应格式
  return {
    choices: [{
      message: {
        content: fullContent,
        role: 'assistant',
      },
      finish_reason: 'stop',
    }],
  };
}

// 通用 AI 调用函数
interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callAI(
  messages: AIMessage[],
  temperature: number = 0.7
): Promise<string | null> {
  if (isLiteLLM()) {
    const response = await callLiteLLM({
      model: getModel(),
      messages,
      temperature,
    });
    return response.choices[0]?.message?.content || null;
  } else {
    const completion = await openai.chat.completions.create({
      model: getModel(),
      messages,
      response_format: { type: 'json_object' },
      temperature,
    });
    return completion.choices[0].message.content;
  }
}

/**
 * 核心 JSON 解析器 - 处理 AI 不稳定的输出
 */
function parseAIJSON<T>(content: string | null): T {
  if (!content) {
    throw new Error('AI 返回内容为空');
  }

  let clean = content.trim();

  // 1. 优先提取 Markdown 代码块
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = clean.match(codeBlockRegex);
  if (match && match[1]) {
    clean = match[1].trim();
  }

  // 2. 寻找最外层的 {}
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  } else {
    throw new Error('AI 返回内容不包含有效的 JSON 数据格式');
  }

  try {
    return JSON.parse(clean) as T;
  } catch (e) {
    console.error('JSON Parse Error:', e);
    console.error('Cleaned Content:', clean);
    throw new Error('AI 返回的 JSON 格式有语法错误');
  }
}

/**
 * 书籍批量分类
 */
export async function classifyBooks(
  titles: string[],
  existingCategories: string[] = []
): Promise<Partial<Book>[]> {
  const messages = [
    { role: 'system' as const, content: BOOK_CLASSIFIER_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildBookClassifierUserPrompt({ titles, existingCategories }) }
  ];

  let content: string | null;

  if (isLiteLLM()) {
    // LiteLLM: 使用原始 HTTP，不添加 max_tokens
    const response = await callLiteLLM({
      model: getModel(),
      messages,
      temperature: 0.3,
    });
    content = response.choices[0]?.message?.content || null;
  } else {
    // DeepSeek: 使用 OpenAI SDK
    const completion = await openai.chat.completions.create({
      model: getModel(),
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    content = completion.choices[0].message.content;
  }

  const data = parseAIJSON<{ books: Partial<Book>[] }>(content);

  if (!data.books || !Array.isArray(data.books)) {
    throw new Error('AI 返回数据格式错误');
  }

  return data.books;
}

/**
 * 个性化阅读推荐（支持分级对话）
 */
export async function getRecommendations(
  context: AIRequestContext
): Promise<AIResponse> {
  const content = await callAI([
    { role: 'system', content: READING_ADVISOR_SYSTEM_PROMPT },
    { role: 'user', content: buildReadingAdvisorUserPrompt(context) }
  ], 0.7);

  return parseAIJSON<AIResponse>(content);
}

/**
 * 分类专项对话
 * 当用户在特定分类下提问时使用
 */
export async function getCategoryFocusedAdvice(
  category: string,
  subcategory: string | undefined,
  books: Book[],
  userQuestion: string
): Promise<AIResponse> {
  const content = await callAI([
    { role: 'system', content: READING_ADVISOR_SYSTEM_PROMPT + '\n\n【特殊指令】用户正在特定分类下咨询，请专注于该领域的书籍。' },
    { role: 'user', content: buildCategoryFocusedPrompt(category, subcategory, books, userQuestion) }
  ], 0.5);

  return parseAIJSON<AIResponse>(content);
}

/**
 * 生成书籍深度解读
 * 支持传入豆瓣数据以获得更精准的解读
 */
export async function generateInsight(
  title: string,
  author: string,
  level: BookLevel,
  category?: string,
  subcategory?: string,
  totalPages?: number,
  doubanData?: {
    rating?: number;
    ratingCount?: number;
    summary?: string;
    tags?: string[];
    publisher?: string;
    pubdate?: string;
  }
): Promise<AIInsight> {
  console.log(`[AI] 生成书籍解读: ${title}, 难度: ${level}`);
  console.log(`[AI] 豆瓣数据:`, doubanData ? {
    rating: doubanData.rating,
    hasSummary: !!doubanData.summary,
    tagsCount: doubanData.tags?.length || 0
  } : '无');
  
  const content = await callAI([
    { role: 'system', content: INSIGHT_GENERATOR_SYSTEM_PROMPT },
    { role: 'user', content: buildInsightGeneratorUserPrompt({ title, author, level, category, subcategory, totalPages, doubanData }) }
  ], 0.4);

  console.log(`[AI] 原始响应:`, content?.substring(0, 200) + '...');
  
  const result = parseAIJSON<AIInsight>(content);
  console.log(`[AI] 解析结果:`, {
    hasSummary: !!result.summary,
    hasAdvice: !!result.advice,
    keyChaptersCount: result.keyChapters?.length || 0
  });
  
  return result;
}

/**
 * 规划阅读路径
 */
export async function generateReadingPath(
  books: Book[],
  category: string,
  subcategory?: string,
  customRequirements?: string
): Promise<ReadingPathResponse> {
  const simplifiedBooks = books.map(b => ({
    id: b.id,
    title: b.title,
    author: b.author,
    level: b.level,
    status: b.status,
    summary: b.aiInsight?.summary?.slice(0, 100)
  }));

  const systemPrompt = `你是一个高级课程设计师，擅长规划学习路径。

请根据书籍的难度、内容依赖关系、用户的阅读状态，规划最佳阅读顺序。

排序原则：
1. 难度递进：Basic -> Advanced -> Expert
2. 内容依赖：基础理论在前，应用实践在后
3. 状态优先：正在阅读的书优先，未读的书按逻辑排序
4. 用户目标：如果用户有特定目标，优先满足

输出 JSON 格式：
{
  "sortedBookIds": ["id1", "id2", ...],
  "reasoning": "详细的规划理由",
  "estimatedTotalDays": 90,
  "pathStages": [
    {
      "stage": 1,
      "bookIds": ["id1"],
      "theme": "该阶段主题",
      "description": "阶段描述"
    }
  ]
}`;

  const userPrompt = `请为以下书籍规划阅读路径。

领域: ${category}${subcategory ? ` > ${subcategory}` : ''}
${customRequirements ? `用户目标: ${customRequirements}` : ''}

书籍列表:
${JSON.stringify(simplifiedBooks, null, 2)}`;

  const content = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 0.3);

  return parseAIJSON<ReadingPathResponse>(content);
}

/**
 * 智能整理书库分类
 */
export async function reorganizeLibrary(
  books: Book[]
): Promise<Record<string, { category: string; subcategory: string; tags?: string[] }>> {
  const systemPrompt = `你是一个图书馆分类专家。

请对书籍进行重新归类，建立清晰的分类体系。

要求：
1. 合并语义重复的分类
2. 保持分类数量适中（5-10个一级分类）
3. 每个分类下的子分类清晰
4. 为每本书添加合适的标签

输出 JSON 格式：
{
  "mapping": [
    {
      "bookId": "id",
      "category": "一级分类",
      "subcategory": "二级分类",
      "tags": ["标签1", "标签2"]
    }
  ]
}`;

  const userPrompt = `请重新分类以下书籍：\n\n${JSON.stringify(
    books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      currentCategory: b.category,
      currentSubcategory: b.subcategory,
      summary: b.aiInsight?.summary?.slice(0, 80)
    })),
    null,
    2
  )}`;

  const content = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 0.3);

  const data = parseAIJSON<{ mapping: Array<{ bookId: string; category: string; subcategory: string; tags?: string[] }> }>(
    content
  );

  // 转换为 Record 格式
  const result: Record<string, { category: string; subcategory: string; tags?: string[] }> = {};
  data.mapping.forEach(item => {
    result[item.bookId] = {
      category: item.category,
      subcategory: item.subcategory,
      tags: item.tags
    };
  });

  return result;
}
