import OpenAI from "openai";
import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation } from "../types";
import { v4 as uuidv4 } from 'uuid';

// Initialize OpenAI client pointing to DeepSeek API
// 优先使用环境变量 VITE_DEEPSEEK_API_KEY，如果不存在则使用硬编码的 Key 作为兜底（仅供演示，生产环境请在 Netlify 环境变量中设置）
const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY || "sk-a4e54f01705a4f1e8c91bb84f9e580b5";

const client = new OpenAI({
  apiKey: apiKey,
  baseURL: "https://api.deepseek.com",
  dangerouslyAllowBrowser: true
});

// Helper to chunk array for batch processing
export const chunkArray = <T,>(array: T[], size: number): T[][] => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export const analyzeBookBatch = async (bookTitles: string[], existingCategories: string[] = []): Promise<Partial<Book>[]> => {
  const categoriesContext = existingCategories.length > 0 
    ? `当前图书馆已有分类：${existingCategories.join(', ')}。如果书籍适合，请优先使用现有分类以保持一致性；如果完全不相关，请创建新的精准分类。不要强行归类。` 
    : '';

  const systemPrompt = `
你是一个专业的图书管理员。请分析用户提供的书单。
必须严格按照 JSON 格式输出。
不要输出任何 Markdown 标记（如 \`\`\`json），只输出纯 JSON 字符串。

${categoriesContext}

JSON 结构如下：
{
  "books": [
    {
      "title": "书名",
      "author": "推测的作者",
      "category": "领域 (例如: 历史, 计算机, 心理学, 商业, 小说 等)",
      "level": "Basic" | "Advanced" | "Expert"
    }
  ]
}

level 字段必须严格是 "Basic", "Advanced", "Expert" 其中之一。
  `;

  const userPrompt = `请整理以下书籍：\n${bookTitles.join('\n')}`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) return [];

    const data = JSON.parse(content);
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
  const systemPrompt = `
你是一个专业的深度阅读顾问。
必须严格按照 JSON 格式输出。
不要输出任何 Markdown 标记，只输出纯 JSON 字符串。

JSON 结构如下：
{
  "summary": "200字以内的精炼简介（中文）",
  "advice": "针对该书难度等级的具体阅读策略建议（中文）",
  "keyChapters": ["核心章节或关键概念1", "核心章节或关键概念2", "核心章节或关键概念3"]
}
  `;

  const userPrompt = `我准备开始阅读《${title}》（作者：${author}）。这本书被评级为 ${level}。请提供阅读指南。`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    return JSON.parse(content) as AIInsight;
  } catch (error) {
    console.error("Insight generation failed", error);
    throw error;
  }
};

export const generateReadingPath = async (books: Book[], categoryName: string): Promise<ReadingPathResponse> => {
  const systemPrompt = `
你是一个高级课程设计师。用户有一组关于 "${categoryName}" 的书籍。
请根据书籍的难度（Basic -> Expert）以及知识的前置依赖关系，为用户规划一个最佳的阅读顺序。
必须严格按照 JSON 格式输出。

JSON 结构如下：
{
  "sortedBookIds": ["id_1", "id_2", ...], // 按照推荐顺序排列的书籍ID数组
  "reasoning": "一段简短的中文说明，解释为什么推荐这个学习路径（例如：先打基础，再深入xx主题）。"
}
  `;

  // Simplify book object to save tokens
  const simplifiedBooks = books.map(b => ({ id: b.id, title: b.title, author: b.author, level: b.level }));
  const userPrompt = `书籍列表数据：\n${JSON.stringify(simplifiedBooks)}`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    return JSON.parse(content) as ReadingPathResponse;
  } catch (error) {
    console.error("Reading path generation failed", error);
    throw error;
  }
};

export const recommendBooks = async (currentBooks: Book[], categoryName: string): Promise<Recommendation[]> => {
  const systemPrompt = `
你是一个严谨的学术顾问和图书管理员。用户对 "${categoryName}" 领域感兴趣，但书单可能不完整。
请分析已有的书单，推荐 3-5 本**绝对经典、经过时间考验的权威著作**来填补知识盲区。

**严格推荐规则**：
1. **推荐领域经典**：必须是全球范围内该领域的基石之作（不限于中国著作，也不限于外国著作）。
2. **优先推荐中文版**：书名请提供中文名称。
3. **指定最佳版本**：对于外文翻译作品，**必须**明确指出最佳/最权威的中译本（例如：译者姓名、出版社）。例如：“商务印书馆 - 汉译世界学术名著丛书”或“某某 译”。这是必须的，因为烂翻译会毁了经典。
4. **严禁网红书**：绝对不要推荐畅销快餐书、成功学或肤浅的通俗读物。
5. **补充缺口**：推荐的书籍应能补充当前书单未覆盖的重要子领域或深度。

必须严格按照 JSON 格式输出。
JSON 结构：
{
  "recommendations": [
    {
      "title": "书名(中文)",
      "author": "作者",
      "publisher": "推荐的最佳中文版本/出版社/译者 (例如: '商务印书馆 - 何兆武译')",
      "reason": "推荐理由（中文，详细说明该书的经典地位，以及为什么推荐这个特定的版本）",
      "level": "Basic" | "Advanced" | "Expert"
    }
  ]
}
  `;

  const simplifiedBooks = currentBooks.map(b => ({ title: b.title, author: b.author }));
  const userPrompt = `当前已拥有的 "${categoryName}" 书籍：\n${JSON.stringify(simplifiedBooks)}\n请推荐经典书籍补充，务必指名最佳版本。`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const data = JSON.parse(content);
    return data.recommendations;
  } catch (error) {
    console.error("Recommendation failed", error);
    throw error;
  }
};

export const reorganizeLibrary = async (books: Book[]): Promise<Record<string, string>> => {
  const systemPrompt = `
你是一个专业的图书馆分类专家。请审视这份完整的书籍清单。
当前存在分类碎片化的问题（例如“历史”、“世界历史”、“近代史”可能应该统一归类，或者保留层级但统一命名规范）。
请对书籍进行重新归类，合并语义重复的分类。

**原则**：
1. 保持分类的专业性和简洁性。
2. 相似的领域请合并（如 CS, Computer, 计算机 -> 计算机科学）。
3. 如果分类已经很好，则保持不变。
4. 返回所有书籍 ID 到新分类的映射。

必须严格按照 JSON 格式输出。
JSON 结构：
{
  "mapping": {
    "book_id_1": "新分类名称",
    "book_id_2": "新分类名称"
    ...所有书籍必须包含...
  }
}
  `;

  // Simplify payload: ID, Title, Current Category
  const payload = books.map(b => ({ id: b.id, title: b.title, category: b.category }));
  const userPrompt = `书籍清单：\n${JSON.stringify(payload)}`;

  try {
    const response = await client.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const data = JSON.parse(content);
    return data.mapping;
  } catch (error) {
    console.error("Reorganization failed", error);
    throw error;
  }
};