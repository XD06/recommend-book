/**
 * Prompt 共享模板系统
 *
 * 统一管理所有 prompt 中重复的部分：
 * - 工具说明模板（单一来源，避免 7 处重复）
 * - JSON 输出格式约束
 * - 通用准确性约束
 * - Web 搜索工具说明（条件性启用）
 * - 推荐质量约束（新增）
 * - 深度理解框架（新增）
 */

// 运行时判断是否启用 Web 搜索
import { isWebSearchEnabled } from '../services/webSearchService';

// ============================================================================
// 工具说明模板 — 所有 Agent 模式共用的工具描述
// ============================================================================

/** 仅书库工具的基础模板 */
const LIBRARY_TOOL_DESC = `你拥有一组工具来查询用户书库：
- search_library: 搜索书库（按关键词/分类/标签/状态/难度）
- get_book_details: 获取书籍详细信息（AI解读、豆瓣摘要、进度）
- get_category_stats: 查看分类统计
- get_reading_history: 查看已读书籍历史
- get_user_profile: 查看用户画像
- get_reading_taste_profile: 获取用户阅读品味画像（自动分析的阅读偏好、知识结构、阅读轨迹）
- get_reading_gaps: 获取知识缺口分析（识别用户知识体系中的薄弱环节）
- update_book_status: 更新书籍阅读状态和进度（写操作）`;

/** Web 搜索工具说明（仅在 EXA_API_KEY 配置后启用） */
const WEB_TOOL_DESC = `
- web_search: 搜索互联网获取实时信息（最新书籍推荐、书评评分、学习资源、作者背景、学术研究等）
- web_fetch: 获取指定 URL 的网页详细内容（当搜索摘要不够时使用）`;

/** Web 搜索慎用指南 */
const WEB_SEARCH_GUIDELINE = `
## Web 搜索使用准则

1. **优先使用书库工具**: 先搜索书库，只有书库无法满足时才用 web_search
2. **选择合适的 category**:
   - book_reviews: 查书评评分（豆瓣、Goodreads、Amazon）
   - book_recommendations: 找推荐书单（豆瓣、知乎、Goodreads）
   - academic_research: 查学术论文和前沿研究（arXiv、Scholar）
   - learning_resources: 找在线课程和学习路径（Coursera、B站等）
   - author_info: 查作者背景和书籍背景信息（维基、百度百科）
   - general: 通用搜索（不限域名）
3. **搜索深度 searchType**:
   - auto（默认）: 平衡速度和质量，适合大多数查询
   - fast: 快速搜索，适合简单事实查询（如"某书的豆瓣评分"）
   - deep: 深度推理搜索（4-15秒），适合复杂/开放式查询（如"2024年最值得读的AI入门书"），仅在前两次搜索不够时使用
4. **慎用 web_fetch**: web_search 返回的 highlights 和 summary 通常足够，仅在需要深入细节时才用 web_fetch
5. **引用来源**: 基于 Web 搜索结果推荐外部书籍时，请在 reason 中注明信息来源（如"豆瓣评分8.5"、"知乎推荐"）
6. **会话限额**: 单次对话最多 5 次 Web 工具调用，请合理规划搜索策略`;

/** 条件性生成工具描述模板（运行时判断是否包含 Web 工具） */
export const TOOL_DESCRIPTION_TEMPLATE = LIBRARY_TOOL_DESC;

/** 获取完整的工具描述（条件性包含 Web 工具） */
function getFullToolDescription(): string {
  if (isWebSearchEnabled()) {
    return LIBRARY_TOOL_DESC + WEB_TOOL_DESC;
  }
  return LIBRARY_TOOL_DESC;
}

/**
 * 为 system prompt 附加工具说明
 * @param systemPrompt 原始 system prompt
 * @param maxRounds 最大工具调用轮次
 * @param extraHint 额外提示（如"当用户问题涉及..."）
 */
export function withTools(
  systemPrompt: string,
  maxRounds: number = 5,
  extraHint?: string,
): string {
  // 运行时判断是否包含 Web 工具
  const toolDesc = getFullToolDescription();
  let result = `${systemPrompt}\n\n${toolDesc}`;
  if (extraHint) {
    result += `\n\n${extraHint}`;
  }
  // 条件性添加 Web 搜索使用准则
  if (isWebSearchEnabled()) {
    result += WEB_SEARCH_GUIDELINE;
  }
  result += `\n\n你可以根据需要使用工具查询用户书库，以获得更精准的结果。建议优先使用 get_reading_taste_profile 和 get_reading_gaps 了解用户的阅读品味和知识缺口，这样你的推荐会更加精准和有洞察力。如果书库概览中已有足够信息，可以直接给出回复。如需使用工具，最多 ${maxRounds} 轮即可。`;
  return result;
}

// ============================================================================
// JSON 输出格式约束
// ============================================================================

export const JSON_FORMAT_CONSTRAINT = `返回纯 JSON，不要包含任何注释、Markdown 代码块或额外文本。`;

export const ACCURACY_CONSTRAINTS = `## 准确性要求

1. **bookId 必须准确**: libraryMatches 中的 bookId 必须来自用户书库中实际存在的书籍 ID，不要编造
2. **外部推荐需真实**: externalMatches 中的书籍必须是确实存在的出版物，不要杜撰书名或作者
3. **推荐理由需具体**: 避免使用"这是一本好书"等泛泛之谈，要具体说明这本书如何匹配用户的需求
4. **难度等级需匹配**: 推荐的书籍难度应与用户的阅读水平相匹配，避免向初学者推荐专家级书籍
5. **外部推荐可信度**: 每本外部推荐的书籍请标注 confidence 字段（"high"表示非常有把握确实存在，"medium"表示可能存在但不确定细节，"low"表示不太确定）`;

// ============================================================================
// 深度理解框架 — 所有推荐场景共享的分析维度
// ============================================================================

export const DEEP_UNDERSTANDING_FRAMEWORK = `## 深度理解框架

在给出任何推荐之前，请先从以下维度理解用户：

### 阅读品味推断
从用户书库的数据中推断：
- **知识结构**：用户在哪些领域有积累？深度如何？
- **阅读偏好**：偏理论还是实践？偏入门还是挑战？
- **阅读节奏**：是快速浏览型还是深度精读型？
- **潜在兴趣**：从已读书籍中能推断出哪些未明说的兴趣？

### 阅读轨迹分析
- **从哪里来**：最早读的书 → 反映起点和初始动机
- **到哪里去**：最近读的书 → 反映当前方向
- **在哪里停**：正在读但进度缓慢的书 → 反映可能的困难
- **在哪里跳**：频繁切换分类 → 可能缺乏深度或正在探索

### 知识缺口识别
- 同一分类只有入门书，缺少进阶 → 深度缺口
- 只读一个领域，缺少跨学科 → 广度缺口
- 读了理论，缺少实践类 → 应用缺口
- 读了旧版，缺少新版/新出版物 → 时效缺口`;

// ============================================================================
// Few-Shot 示例库
// ============================================================================

export const READING_ADVISOR_FEW_SHOT = `## 示例

### 示例 1

用户："最近想学 Rust，有相关书籍吗？"
书库中有：《Rust 程序设计语言》《C 程序设计语言》《深入理解计算机系统》

输出：
{
  "analysis": "你对系统编程感兴趣，想学 Rust 是个好选择。你书库中已有《Rust 程序设计语言》，这是最权威的入门资料。同时你的 CSAPP 基础会帮助你理解底层概念。",
  "readingInsight": "你的阅读轨迹从 C 到 CSAPP 再到 Rust，体现了对系统编程安全性的逐步关注，这是很好的深入路径。",
  "recommendationStrategy": "优先利用书库中已有的 Rust 入门书，外部推荐补充进阶实践类书籍",
  "libraryMatches": [
    {
      "bookId": "实际书库中的ID",
      "reason": "Rust 官方推荐入门书，涵盖所有权、生命周期等核心概念，适合有 C 语言基础的开发者",
      "timing": "你刚读完 CSAPP 的内存管理部分，正好可以对比 Rust 的所有权模型",
      "prerequisite": "C 语言基础（已满足）",
      "relevanceScore": 0.95
    }
  ],
  "externalMatches": [
    {
      "title": "Rust 权威指南",
      "author": "Steve Klabnik, Carol Nichols",
      "publisher": "人民邮电出版社",
      "reason": "比官方书更详细的中文版指南，适合系统学习。如果觉得太厚，可以先看《Rust 程序设计语言》在线版作为速览",
      "level": "Basic",
      "category": "计算机科学",
      "subcategory": "编程语言",
      "confidence": "high"
    }
  ],
  "suggestedQuestions": ["我需要先复习 C 语言吗？", "学完 Rust 之后我该怎么进阶？"]
}`;
