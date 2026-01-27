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

// 增强版 JSON 解析辅助函数，能从 AI 的废话中提取 JSON
const parseDeepSeekJSON = (content: string | null) => {
  if (!content) return null;
  
  // 1. 尝试使用正则提取第一个 JSON 对象 {...}
  // 匹配非贪婪的最外层大括号
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn("Regex extraction failed, trying cleanup...", e);
    }
  }

  // 2. 降级方案：清理 Markdown 标记
  let cleanContent = content.trim();
  if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  
  try {
    return JSON.parse(cleanContent);
  } catch (e) {
    console.error("JSON Parse Error:", e, "Raw Content:", content);
    throw new Error("AI 返回格式错误，无法解析为 JSON");
  }
};

export const analyzeBookBatch = async (bookTitles: string[], existingCategories: string[] = []): Promise<Partial<Book>[]> => {
  const categoriesContext = existingCategories.length > 0 
    ? `当前图书馆已有的一级分类（Domain）：${existingCategories.join(', ')}。请尽量复用现有的一级分类。` 
    : '';

  const systemPrompt = `你是一个专业的图书管理员。请分析用户提供的书单。
${categoriesContext}
请为每一本书识别作者(英文名作者需要翻译成中文，英文名也要保留)、一级分类(Domain)、二级分类(Subcategory)和难度等级。

**分类原则**：
1. **category (一级分类)**: 宏观领域，如“计算机科学”、“历史”、“商业”、“心理学”、“文学”。
2. **subcategory (二级分类)**: 具体主题，如“计算机科学”下的“人工智能”、“Web开发”、“网络安全”；或“历史”下的“中国古代史”、“二战史”。

**输出格式要求**：
请直接返回一个纯 JSON 对象，不要包含任何 Markdown 格式或额外文字：
{
  "books": [
    { "title": "书名", "author": "作者", "category": "一级分类", "subcategory": "二级分类", "level": "Basic/Advanced/Expert" }
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
      subcategory: b.subcategory || 'General', // Fallback
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
  "summary": "几百字的中文简介",
  "advice": "针对 ${level} 难度的具体阅读策略和建议",
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

export const generateReadingPath = async (
  books: Book[], 
  categoryName: string, 
  subcategoryName?: string, 
  customRequirements?: string
): Promise<ReadingPathResponse> => {
  const simplifiedBooks = books.map(b => ({ 
    id: b.id, 
    title: b.title, 
    author: b.author, 
    subcategory: b.subcategory, 
    level: b.level 
  }));
  
  const reqPrompt = customRequirements 
    ? `用户有个性化阅读目标："${customRequirements}"。请务必根据此目标调整阅读顺序（例如：如果用户想先看实战，就优先排实战类的书）。` 
    : "请根据从基础到高阶的学习曲线进行规划。";

  const contextStr = subcategoryName 
    ? `领域：${categoryName}，具体主题：${subcategoryName}` 
    : `领域：${categoryName}`;

  const systemPrompt = `你是一个高级课程设计师。请以 JSON 格式规划阅读路径。
**重要**：输出必须是合法的 JSON 对象。

输出结构：
{
  "sortedBookIds": ["id1", "id2", ...],
  "reasoning": "详细的规划理由，解释为什么这样排序。如果用户有特殊要求，请在理由中说明是如何满足的。"
}`;

  const userPrompt = `请为以下书籍规划最佳阅读顺序。
上下文：${contextStr}
${reqPrompt}

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
2. 优先推荐最佳中文译本。
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

export const reorganizeLibrary = async (books: Book[]): Promise<Record<string, { category: string, subcategory: string }>> => {
  // Minimize payload to avoid token limits
  const payload = books.map(b => ({ id: b.id, title: b.title }));
  
  const systemPrompt = `你是一个图书馆分类专家。
请对书籍进行重新归类，建立清晰的二级分类体系（Category -> Subcategory）。
合并语义重复的分类。
返回 JSON 格式：
{
  "mapping": [
    { "bookId": "id", "newCategory": "一级分类", "newSubcategory": "二级分类" }
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
    
    const result: Record<string, { category: string, subcategory: string }> = {};
    if (data.mapping && Array.isArray(data.mapping)) {
      data.mapping.forEach((item: any) => {
        result[item.bookId] = {
          category: item.newCategory,
          subcategory: item.newSubcategory
        };
      });
    }
    return result;
  } catch (error) {
    console.error("Reorganization failed", error);
    throw error;
  }
};

export const refineSubcategories = async (books: Book[], category: string, userInstruction: string): Promise<Record<string, string>> => {
  const payload = books.map(b => ({ id: b.id, title: b.title, currentSubcategory: b.subcategory }));
  
  const systemPrompt = `你是一个细心的图书整理员。
用户觉得当前 "${category}" 领域下的子分类（Subcategories）不够好。
请根据用户的**具体指令**，只修改这些书的 **Subcategory** 字段。
**一级分类 Category 保持不变**。

用户指令：${userInstruction}

请尽量保持子分类数量适中（3-6个为宜），除非用户要求更细。
返回 JSON 格式：
{
  "mapping": [
    { "bookId": "id", "newSubcategory": "新的子分类名称" }
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
        result[item.bookId] = item.newSubcategory;
      });
    }
    return result;
  } catch (error) {
    console.error("Refining subcategories failed", error);
    throw error;
  }
};