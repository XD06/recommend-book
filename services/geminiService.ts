import { GoogleGenAI, Type } from "@google/genai";
import { Book, BookLevel, AIInsight, ReadingPathResponse, Recommendation } from "../types";
import { v4 as uuidv4 } from 'uuid';

// Initialize Google GenAI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    ? `当前图书馆已有分类：${existingCategories.join(', ')}。如果书籍适合，请优先使用现有分类以保持一致性；如果完全不相关，请创建新的精准分类。` 
    : '';

  const prompt = `
你是一个专业的图书管理员。请分析用户提供的书单。

${categoriesContext}

请为每一本书识别作者(英文名作者需要翻译成中文，英文名也要保留)、分类（例如: 历史, 计算机, 心理学, 商业, 小说 等）和难度等级（Basic, Advanced, Expert）。
书单：
${bookTitles.join('\n')}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            books: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  author: { type: Type.STRING },
                  category: { type: Type.STRING },
                  level: { type: Type.STRING, enum: ["Basic", "Advanced", "Expert"] }
                },
                required: ["title", "author", "category", "level"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const data = JSON.parse(text);
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
  const prompt = `
我准备开始阅读《${title}》（作者：${author}）。这本书被评级为 ${level}。
请提供阅读指南，包含：
1. 200字以内的精炼简介（中文）
2. 针对该书难度等级的具体阅读策略建议（中文）
3. 3个核心章节或关键概念
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            advice: { type: Type.STRING },
            keyChapters: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["summary", "advice", "keyChapters"]
        }
      }
    });

    if (!response.text) throw new Error("No response from AI");
    return JSON.parse(response.text) as AIInsight;
  } catch (error) {
    console.error("Insight generation failed", error);
    throw error;
  }
};

export const generateReadingPath = async (books: Book[], categoryName: string): Promise<ReadingPathResponse> => {
  const simplifiedBooks = books.map(b => ({ id: b.id, title: b.title, author: b.author, level: b.level }));
  const prompt = `
你是一个高级课程设计师。用户有一组关于 "${categoryName}" 的书籍。
请根据书籍的难度（Basic -> Expert）以及知识的前置依赖关系，为用户规划一个最佳的阅读顺序。
书籍列表：
${JSON.stringify(simplifiedBooks)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sortedBookIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            reasoning: { type: Type.STRING }
          },
          required: ["sortedBookIds", "reasoning"]
        }
      }
    });

    if (!response.text) throw new Error("No response from AI");
    return JSON.parse(response.text) as ReadingPathResponse;
  } catch (error) {
    console.error("Reading path generation failed", error);
    throw error;
  }
};

export const recommendBooks = async (currentBooks: Book[], categoryName: string, customRequirements?: string): Promise<Recommendation[]> => {
  const simplifiedBooks = currentBooks.map(b => ({ title: b.title, author: b.author }));
  const existingContext = currentBooks.length > 0 
    ? `用户当前已拥有以下 "${categoryName}" 类书籍（共${currentBooks.length}本）：\n${JSON.stringify(simplifiedBooks)}`
    : `用户对 "${categoryName}" 感兴趣，但目前没有该类书籍。`;

  const requirementPrompt = customRequirements 
    ? `**用户特别要求（必须优先满足）**：${customRequirements}。`
    : `请分析上述书单的缺口，推荐 3-5 本**绝对经典、经过时间考验的权威著作**来填补知识盲区。`;

  const prompt = `
你是一个严谨的学术顾问和资深图书管理员。
${existingContext}

你的任务是根据现有书单和用户的具体要求进行精准推荐。
${requirementPrompt}

**推荐逻辑原则**：
1. **查漏补缺**：如果现有书单偏向入门，推荐进阶；如果偏向某一学派，推荐另一视角的经典。目标是为了帮助用户建立全面完整系统的视角。
2. **权威版本**：必须推荐最佳中文译本。
3. **拒绝水书**：严禁推荐畅销快餐书。

**输出格式**：
必须严格按照 JSON 格式输出 3 到 5 本推荐书籍。
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  author: { type: Type.STRING },
                  publisher: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  level: { type: Type.STRING, enum: ["Basic", "Advanced", "Expert"] }
                },
                required: ["title", "author", "publisher", "reason", "level"]
              }
            }
          }
        }
      }
    });

    if (!response.text) throw new Error("No response from AI");
    const data = JSON.parse(response.text);
    return data.recommendations;
  } catch (error) {
    console.error("Recommendation failed", error);
    throw error;
  }
};

export const reorganizeLibrary = async (books: Book[]): Promise<Record<string, string>> => {
  const payload = books.map(b => ({ id: b.id, title: b.title, category: b.category }));
  
  const prompt = `
你是一个专业的图书馆分类专家。请审视这份书籍清单。
请对书籍进行重新归类，合并语义重复的分类（例如“历史”、“世界历史”合并）。
返回书籍ID到新分类的映射。

书籍清单：
${JSON.stringify(payload)}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mapping: {
              type: Type.ARRAY,
              items: {
                  type: Type.OBJECT,
                  properties: {
                      bookId: { type: Type.STRING },
                      newCategory: { type: Type.STRING }
                  },
                  required: ["bookId", "newCategory"]
              }
            }
          }
        }
      }
    });

    if (!response.text) throw new Error("No response from AI");
    const data = JSON.parse(response.text);
    
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