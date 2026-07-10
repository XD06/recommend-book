/**
 * 书籍解读生成提示词
 * 
 * 为单本书生成深度解读：简介、阅读建议、核心章节
 */

import { BookLevel } from '../types';

export const INSIGHT_GENERATOR_SYSTEM_PROMPT = `你是一个深度阅读助手，擅长为读者提供书籍的个性化解读。

## 任务

为指定书籍生成三部分的深度解读：

### 1. 核心简介 (summary)
- 200-300 字的中文简介
- 概括书的核心理论/思想
- 说明这本书为什么重要
- 避免剧透关键内容

### 2. 阅读建议 (advice)
- 针对读者当前水平（Basic/Advanced/Expert）的具体建议
- 阅读顺序建议（哪些章节优先）
- 阅读方法建议（精读/跳读/笔记重点）
- 相关前置知识要求

### 3. 核心章节 (keyChapters)
- 列出 3-5 个最值得重点阅读的章节
- 每个章节说明为什么重要
- 给出章节标题和简要说明

## 难度适配

根据书籍难度调整建议：

- **Basic (入门)**: 
  - 强调基础概念的理解
  - 建议配合实例学习
  - 推荐延伸阅读

- **Advanced (进阶)**:
  - 强调实践应用
  - 建议批判性阅读
  - 推荐对比阅读

- **Expert (专家)**:
  - 强调理论深度
  - 建议研究性阅读
  - 推荐原始文献

## 输出格式

返回纯 JSON：

{
  "summary": "书籍简介...",
  "advice": "阅读建议...",
  "keyChapters": [
    "第X章: 章节标题 - 简要说明",
    "第Y章: 章节标题 - 简要说明"
  ]
}

## 示例

书籍：《思考，快与慢》丹尼尔·卡尼曼
难度：Advanced

输出：
{
  "summary": "诺贝尔经济学奖得主卡尼曼的经典之作，系统阐述了人类思维的两种模式：快速直觉的系统1和缓慢理性的系统2。书中通过大量实验揭示了人类决策中的认知偏差，如锚定效应、可得性启发、损失厌恶等。这本书不仅是心理学巨著，更是理解人类行为、改进决策质量的必读之作。",
  "adapters": "本书篇幅较长，建议先精读第1-5章建立核心概念框架，然后根据自己兴趣选择相关章节深入。建议边读边思考自己在日常生活中的决策案例，将理论应用到实际。对于进阶读者，建议配合《助推》《错误的行为》一起阅读，形成完整的认知科学知识体系。",
  "keyChapters": [
    "第1章: 系统1与系统2 - 理解两种思维模式的核心区别",
    "第4章: 联想机制 - 了解直觉是如何工作的",
    "第10章: 锚定效应 - 认识到数字如何影响判断",
    "第25章: 损失厌恶 - 理解为什么失去比得到更痛苦",
    "第34章: 体验自我与记忆自我 - 思考幸福的本质"
  ]
}`;

export interface InsightGeneratorInput {
  title: string;
  author: string;
  level: BookLevel;
  category?: string;
  subcategory?: string;
  totalPages?: number;
  doubanData?: {
    rating?: number;
    ratingCount?: number;
    summary?: string;
    tags?: string[];
    publisher?: string;
    pubdate?: string;
  };
}

export function buildInsightGeneratorUserPrompt(input: InsightGeneratorInput): string {
  const { title, author, level, category, subcategory, totalPages, doubanData } = input;
  
  let prompt = `请为以下书籍生成深度解读：\n\n`;
  prompt += `书名: 《${title}》\n`;
  prompt += `作者: ${author}\n`;
  prompt += `难度: ${level}\n`;
  
  if (category) {
    prompt += `分类: ${category}`;
    if (subcategory) {
      prompt += ` > ${subcategory}`;
    }
    prompt += `\n`;
  }
  
  if (totalPages) {
    prompt += `页数: ${totalPages} 页\n`;
  }
  
  // 传入豆瓣数据以获得更精准的解读
  if (doubanData) {
    prompt += `\n## 豆瓣数据参考\n`;
    if (doubanData.rating) {
      prompt += `豆瓣评分: ${doubanData.rating}/10 (${doubanData.ratingCount || '未知'} 人评价)\n`;
    }
    if (doubanData.publisher) {
      prompt += `出版社: ${doubanData.publisher}\n`;
    }
    if (doubanData.pubdate) {
      prompt += `出版日期: ${doubanData.pubdate}\n`;
    }
    if (doubanData.summary) {
      // 截取简介前500字，避免过长
      const summary = doubanData.summary.length > 500 
        ? doubanData.summary.substring(0, 500) + '...' 
        : doubanData.summary;
      prompt += `内容简介: ${summary}\n`;
    }
    if (doubanData.tags && doubanData.tags.length > 0) {
      prompt += `标签: ${doubanData.tags.slice(0, 8).join(', ')}\n`;
    }
    prompt += `\n请结合以上豆瓣数据，生成更准确、更有针对性的阅读指南。`;
  }
  
  prompt += `\n请根据以上信息，生成个性化的阅读指南。`;
  
  return prompt;
}
