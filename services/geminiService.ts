import OpenAI from "openai";
import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation } from "../types";
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// ⚠️ 配置区域：DeepSeek 接入设置
// ============================================================================

// 请在这里填入您的 DeepSeek API Key (以 sk- 开头)
const DEEPSEEK_API_KEY = "sk-a4e54f01705a4f1e8c91bb84f9e580b5"; 

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: DEEPSEEK_API_KEY,
  dangerouslyAllowBrowser: true // 允许在浏览器端运行 (Demo/MVP 专用)
});

// ============================================================================

// Helper to chunk array for batch processing
export const chunkArray = <T,>(array: T[], size: number): T[][] => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

// 通用 JSON 解析辅助函数，防止 DeepSeek 返回 Markdown 代码块格式
const parseDeepSeekJSON = (content: string | null) => {
  if (!content) return null;
  let cleanContent = content.trim();
  // 去除 markdown code block 标记 (```json ... ```)
  if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleanContent);
  } catch (e) {
    console.error("JSON Parse Error:", e, "Content:", content);
    return null;
  }
};

export const analyzeBookBatch = async (bookTitles: string[], existingCategories: string[] = []): Promise<Partial<Book>[]> => {
  const categoriesContext = existingCategories.length > 0 
    ? `当前图书馆已有分类：${existingCategories.join(', ')}。如果书籍适合，请优先使用现有分类以保持一致性；如果完全不相关，请创建新的精准分类。` 
    : '';

  const systemPrompt = `你是一个专业的图书管理员。请分析用户提供的书单。
${categoriesContext}
请为每一本书识别作者(英文名作者需要翻译成中文，英文名也要保留)、分类（例如: 历史, 计算机, 心理学, 商业, 小说 等）和难度等级（Basic, Advanced, Expert）。

**输出格式要求**：
请直接返回一个纯 JSON 对象，格式如下：
{
  "books": [
    { "title": "书名", "author": "作者", "category": "分类", "level": "Basic/Advanced/Expert" }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: bookTitles.join('\n') }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const data = parseDeepSeekJSON(completion.choices[0].message.content);
    if (!data || !data.books) return [];

    return data.books.map((b: any) => ({
      id: uuidv4(),
      title: b.title,
      author: b.author,
      category: b.category,
      level: b.level as BookLevel,
      status: 'unread'
    }));
  } catch (error) {
    console.error("Batch analysis failed", error);
    throw error;
  }
};

export const generateBookInsight = async (title: string, author: string, level: string): Promise<AIInsight> => {
  const systemPrompt = `你是一个深度阅读助手。请以 JSON 格式输出结果。
输出结构：
{
  "summary": "200字以内的中文简介",
  "advice": "针对 ${level} 难度的具体阅读策略",
  "keyChapters": ["核心章节1", "核心章节2", "核心章节3"]
}`;

  const userPrompt = `我准备开始阅读《${title}》（作者：${author}）。这本书被评级为 ${level}。请提供阅读指南。`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const data = parseDeepSeekJSON(completion.choices[0].message.content);
    return data as AIInsight;
  } catch (error) {
    console.error("Insight generation failed", error);
    throw error;
  }
};

export const generateReadingPath = async (books: Book[], categoryName: string): Promise<ReadingPathResponse> => {
  const simplifiedBooks = books.map(b => ({ id: b.id, title: b.title, author: b.author, level: b.level }));
  
  const systemPrompt = `你是一个高级课程设计师。请以 JSON 格式规划阅读路径。
输出结构：
{
  "sortedBookIds": ["id1", "id2", ...],
  "reasoning": "规划理由"
}`;

  const userPrompt = `用户有一组关于 "${categoryName}" 的书籍。
请根据书籍的难度（Basic -> Expert）以及知识的前置依赖关系，为用户规划一个最佳的阅读顺序。
书籍列表：
${JSON.stringify(simplifiedBooks)}`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const data = parseDeepSeekJSON(completion.choices[0].message.content);
    return data as ReadingPathResponse;
  } catch (error) {
    console.error("Reading path generation failed", error);
    throw error;
  }
};

export const recommendBooks = async (currentBooks: Book[], categoryName: string, customRequirements?: string): Promise<Recommendation[]> => {
  const simplifiedBooks = currentBooks.map(b => ({ title: b.title, author: b.author }));
  const existingContext = currentBooks.length > 0 
    ? `用户当前已拥有以下 "${categoryName}" 类书籍：\n${JSON.stringify(simplifiedBooks)}`
    : `用户对 "${categoryName}" 感兴趣。`;

  const requirementPrompt = customRequirements 
    ? `**用户特别要求（必须优先满足）**：${customRequirements}。`
    : `请推荐 3-5 本**绝对经典、经过时间考验的权威著作**来填补知识盲区。`;

  const systemPrompt = `你是一个严谨的学术顾问。
**推荐逻辑原则**：
1. 查漏补缺，构建完整视角。
2. 必须推荐最佳中文译本。
3. 严禁推荐畅销快餐书。

**输出格式**：
必须严格返回 JSON 对象：
{
  "recommendations": [
    {
      "title": "书名",
      "author": "作者",
      "publisher": "推荐版本/出版社",
      "reason": "推荐理由",
      "level": "Basic/Advanced/Expert"
    }
  ]
}`;

  const userPrompt = `${existingContext}\n${requirementPrompt}`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const data = parseDeepSeekJSON(completion.choices[0].message.content);
    return data.recommendations;
  } catch (error) {
    console.error("Recommendation failed", error);
    throw error;
  }
};

export const reorganizeLibrary = async (books: Book[]): Promise<Record<string, string>> => {
  const payload = books.map(b => ({ id: b.id, title: b.title, category: b.category }));
  
  const systemPrompt = `你是一个图书馆分类专家。
请对书籍进行重新归类，合并语义重复的分类（例如“历史”、“世界历史”合并）。
返回 JSON 格式：
{
  "mapping": [
    { "bookId": "id", "newCategory": "新分类" }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const data = parseDeepSeekJSON(completion.choices[0].message.content);
    
    const result: Record<string, string> = {};
    if (data.mapping && Array.isArray(data.mapping)) {
      data.mapping.forEach((item: any) => {
        result[item.bookId] = item.newCategory;
      });
    }
    return result;
  } catch (error) {
    console.error("Reorganization failed", error);
    throw error;
  }
};
