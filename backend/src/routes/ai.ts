/**
 * AI 相关路由
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  classifyBooks,
  getRecommendations,
  getCategoryFocusedAdvice,
  generateInsight,
  generateReadingPath,
  reorganizeLibrary,
} from '../services/aiService';
import { AppError, ErrorCode } from '../types';

const router = Router();

// 验证中间件
const validate = (schema: z.ZodSchema) => (req: any, res: any, next: any) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    next(new AppError(ErrorCode.VALIDATION_ERROR, '请求参数验证失败', 400));
  }
};

// 批量分类书籍
const classifySchema = z.object({
  titles: z.array(z.string()).min(1).max(50),
  existingCategories: z.array(z.string()).optional(),
});

router.post('/classify', validate(classifySchema), async (req, res, next) => {
  try {
    const { titles, existingCategories } = req.body;
    const result = await classifyBooks(titles, existingCategories);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 个性化推荐
const recommendSchema = z.object({
  userRequest: z.string().min(1).max(1000),
  userMood: z.string().optional(),
  library: z.array(z.any()).min(1),
  categoryContext: z.object({
    currentCategory: z.string(),
    parentCategories: z.array(z.string()),
    siblingCategories: z.array(z.string()),
    subCategories: z.array(z.string()),
    booksInContext: z.array(z.any()),
    totalBooks: z.number(),
    readingStats: z.object({
      reading: z.number(),
      finished: z.number(),
      unread: z.number(),
    }),
  }).optional(),
});

router.post('/recommend', validate(recommendSchema), async (req, res, next) => {
  try {
    const result = await getRecommendations(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 分类专项对话
const categoryAdviceSchema = z.object({
  category: z.string(),
  subcategory: z.string().optional(),
  books: z.array(z.any()).min(1),
  userQuestion: z.string().min(1),
});

router.post('/category-advice', validate(categoryAdviceSchema), async (req, res, next) => {
  try {
    const { category, subcategory, books, userQuestion } = req.body;
    const result = await getCategoryFocusedAdvice(category, subcategory, books, userQuestion);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 生成书籍解读
const insightSchema = z.object({
  title: z.string(),
  author: z.string(),
  level: z.enum(['Basic', 'Advanced', 'Expert']),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  totalPages: z.number().optional(),
  doubanData: z.object({
    rating: z.number().optional(),
    ratingCount: z.number().optional(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    publisher: z.string().optional(),
    pubdate: z.string().optional(),
  }).optional(),
});

router.post('/insight', validate(insightSchema), async (req, res, next) => {
  try {
    const result = await generateInsight(
      req.body.title,
      req.body.author,
      req.body.level,
      req.body.category,
      req.body.subcategory,
      req.body.totalPages,
      req.body.doubanData
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 规划阅读路径
const pathSchema = z.object({
  books: z.array(z.any()).min(1),
  category: z.string(),
  subcategory: z.string().optional(),
  customRequirements: z.string().optional(),
});

router.post('/reading-path', validate(pathSchema), async (req, res, next) => {
  try {
    const { books, category, subcategory, customRequirements } = req.body;
    const result = await generateReadingPath(books, category, subcategory, customRequirements);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// 智能整理书库
const reorganizeSchema = z.object({
  books: z.array(z.any()).min(1),
});

router.post('/reorganize', validate(reorganizeSchema), async (req, res, next) => {
  try {
    const result = await reorganizeLibrary(req.body.books);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

export default router;
