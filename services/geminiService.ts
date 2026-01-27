import OpenAI from "openai";
import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation, DebugLogItem } from "../types";
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
// 🛠️ Debug Logging System
// ============================================================================

let debugLogs: DebugLogItem[] = [];

export const getDebugLogs = () => [...debugLogs]; // Return copy
export const clearDebugLogs = () => { debugLogs = []; };

const addLog = (action: string, request: { system?: string, user?: string }, response: any, rawResponse: string | null, error?: any) => {
  const log: DebugLogItem = {
    id: uuidv4(),
    timestamp: new Date().toLocaleTimeString(),
    action,
    request,
    response,
    rawResponse: rawResponse || undefined,
    error: error ? (error instanceof Error ? error.message : String(error)) : undefined
  };
  
  // Store latest 50 logs
  debugLogs.unshift(log);
  if (debugLogs.length > 50) debugLogs.pop();
  
  console.log(`[AI Debug] ${action}`, log);
};

// ============================================================================

// Helper to chunk array for batch processing
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

/**
 * 核心 JSON 解析器 - 专为处理 AI 不稳定的输出设计
 * 能够剥离 Markdown 代码块、去除无关对话文本，精准提取 JSON
 */
const parseDeepSeekJSON = (content: string | null) => {
  if (!content) return null;
  
  let clean = content.trim();

  // 1. 优先尝试提取 Markdown 代码块 (```json ... ```)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = clean.match(codeBlockRegex);
  if (match && match[1]) {
    clean = match[1].trim();
  }

  // 2. 无论是否在代码块中，都寻找最外层的 {}
  // 即使 AI 说 "Okay, here is the json: { ... } Hope you like it", 我们也只取 { ... }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  } else {
    console.error("AI Response does not contain valid JSON structure:", content);
    throw new Error("AI 返回内容不包含有效的 JSON 数据格式");
  }

  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    console.error("Cleaned Content was:", clean);
    throw new Error("AI 返回的 JSON 格式有语法错误，无法解析");
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

  const userPrompt = bookTitles.join('\n');

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('analyzeBookBatch', { system: systemPrompt, user: userPrompt }, data, raw);

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
    addLog('analyzeBookBatch', { system: systemPrompt, user: userPrompt }, null, null, error);
    throw error;
  }
};

export const generateBookInsight = async (title: string, author: string, level: string): Promise<AIInsight> => {
  const systemPrompt = `你是一个深度阅读助手。请以 JSON 格式输出结果。
输出结构：
{
  "summary": "几百字的中文简介，重点概括书的核心思想",
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

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('generateBookInsight', { system: systemPrompt, user: userPrompt }, data, raw);
    
    return data as AIInsight;
  } catch (error) {
    console.error("Insight generation failed", error);
    addLog('generateBookInsight', { system: systemPrompt, user: userPrompt }, null, null, error);
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
    level: b.level,
    status: b.status,
    contentHint: b.aiInsight?.summary ? b.aiInsight.summary.slice(0, 100) + '...' : undefined
  }));
  
  const reqPrompt = customRequirements 
    ? `用户有个性化阅读目标："${customRequirements}"。请务必根据此目标调整阅读顺序。` 
    : "请根据从基础到高阶的学习曲线进行规划。";

  const contextStr = subcategoryName 
    ? `领域：${categoryName}，具体主题：${subcategoryName}` 
    : `领域：${categoryName}`;

  const systemPrompt = `你是一个高级课程设计师。请以 JSON 格式规划阅读路径。
  
**排序逻辑参考**：
1. **难度递进**：通常从 Basic -> Advanced -> Expert。
2. **内容依赖**：参考书籍的 contentHint（内容摘要），如果一本书是另一本书的基础理论，应排在前面。
3. **阅读状态**：status='finished' 的书如果作为后续书籍的基础，应排在前面；但如果用户是想读新书，主要路径应集中在 'unread' 书籍上。

输出结构：
{
  "sortedBookIds": ["id1", "id2", ...],
  "reasoning": "详细的规划理由，解释为什么这样排序（例如：'先读《X》因为它建立了基本概念...'）。"
}`;

  const userPrompt = `请为以下书籍规划最佳阅读顺序。
上下文：${contextStr}
${reqPrompt}

书籍列表数据：
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

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('generateReadingPath', { system: systemPrompt, user: userPrompt }, data, raw);

    return data as ReadingPathResponse;
  } catch (error) {
    console.error("Reading path generation failed", error);
    addLog('generateReadingPath', { system: systemPrompt, user: userPrompt }, null, null, error);
    throw error;
  }
};

export const recommendBooks = async (
  currentBooks: Book[], 
  categoryName: string, 
  subcategoryName?: string | null,
  customRequirements?: string
): Promise<Recommendation[]> => {
  const simplifiedBooks = currentBooks.map(b => ({ title: b.title, author: b.author, category: b.category, subcategory: b.subcategory }));
  
  const contextScope = subcategoryName 
    ? `领域：${categoryName} / 具体子主题：${subcategoryName}` 
    : `领域：${categoryName}`;

  const existingContext = currentBooks.length > 0 
    ? `用户在【${contextScope}】下已拥有以下书籍（请勿重复推荐）：\n${JSON.stringify(simplifiedBooks)}`
    : `用户对【${contextScope}】感兴趣。`;

  const requirementPrompt = customRequirements 
    ? `**用户特别要求（必须优先满足）**：${customRequirements}。`
    : `请推荐 3-5 本**该具体子领域内**绝对经典、经过时间考验的权威著作来填补知识盲区。`;

  const systemPrompt = `你是一个严谨的学术顾问。
**推荐逻辑原则**：
1. 查漏补缺，构建完整视角。
2. 优先推荐最佳中文译本。
3. 严禁推荐畅销快餐书。
4. **极度专注**：如果提供了子主题，必须推荐该子主题下的书，不要推荐宽泛的通识书。

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

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('recommendBooks', { system: systemPrompt, user: userPrompt }, data, raw);

    return data.recommendations;
  } catch (error) {
    console.error("Recommendation failed", error);
    addLog('recommendBooks', { system: systemPrompt, user: userPrompt }, null, null, error);
    throw error;
  }
};

export const reorganizeLibrary = async (books: Book[]): Promise<Record<string, { category: string, subcategory: string }>> => {
  const payload = books.map(b => ({ 
    id: b.id, 
    title: b.title, 
    author: b.author, 
    currentCategory: b.category,
    currentSubcategory: b.subcategory,
    contentHint: b.aiInsight?.summary ? b.aiInsight.summary.slice(0, 100) : undefined
  }));
  
  const systemPrompt = `你是一个图书馆分类专家。
请对书籍进行重新归类，建立清晰的二级分类体系（Category -> Subcategory）。

**数据参考**：
请综合参考书名、作者、当前分类以及 contentHint（内容摘要片段）来进行判断。
合并语义重复的分类（如 "History" 和 "Historical" 应合并）。

返回 JSON 格式：
{
  "mapping": [
    { "bookId": "id", "newCategory": "一级分类", "newSubcategory": "二级分类" }
  ]
}`;

  const userPrompt = JSON.stringify(payload);

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('reorganizeLibrary', { system: systemPrompt, user: userPrompt }, data, raw);

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
    addLog('reorganizeLibrary', { system: systemPrompt, user: userPrompt }, null, null, error);
    throw error;
  }
};

export const refineSubcategories = async (books: Book[], category: string, userInstruction: string): Promise<Record<string, string>> => {
  const payload = books.map(b => ({ 
    id: b.id, 
    title: b.title, 
    author: b.author,
    currentSubcategory: b.subcategory,
    contentHint: b.aiInsight?.summary ? b.aiInsight.summary.slice(0, 100) : undefined
  }));
  
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

  const userPrompt = JSON.stringify(payload);

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });

    const raw = completion.choices[0].message.content;
    const data = parseDeepSeekJSON(raw);
    
    addLog('refineSubcategories', { system: systemPrompt, user: userPrompt }, data, raw);

    const result: Record<string, string> = {};
    if (data.mapping && Array.isArray(data.mapping)) {
      data.mapping.forEach((item: any) => {
        result[item.bookId] = item.newSubcategory;
      });
    }
    return result;
  } catch (error) {
    console.error("Refining subcategories failed", error);
    addLog('refineSubcategories', { system: systemPrompt, user: userPrompt }, null, null, error);
    throw error;
  }
};