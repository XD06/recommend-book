# DeepRead 架构文档

## 项目概述

DeepRead 是一个 AI 驱动的个人阅读管理系统，帮助用户管理书库、获取个性化阅读建议、追踪阅读进度。

## 开发阶段规划

### Phase 1: 前端 Demo（当前）
- 纯前端实现，LocalStorage 存储
- 模拟数据展示完整交互
- 确定 UI/UX 最终形态

### Phase 2: 后端开发
- 搭建后端服务
- 实现豆瓣 API 集成
- 数据库设计

### Phase 3: 前后端联调
- 前端对接真实后端
- 数据迁移方案
- 性能优化

---

## 功能模块分析

### 1. AI 功能矩阵

| 功能 | 当前状态 | 保留 | 优化方向 | 后端依赖 |
|------|---------|------|---------|---------|
| `analyzeBookBatch` | ✅ 在用 | ✅ | 结合豆瓣数据提高准确性 | 需要豆瓣 API |
| `generateBookInsight` | ✅ 在用 | ✅ | 增加章节页码估算 | 无 |
| `generateReadingPath` | ⚠️ 未使用 | ⚠️ 保留 | 结合用户进度智能排序 | 需要用户阅读历史 |
| `recommendBooks` | ✅ 在用 | ✅ | 结合豆瓣评分过滤 | 需要豆瓣 API |
| `reorganizeLibrary` | ✅ 在用 | ✅ | 支持增量整理 | 无 |
| `refineSubcategories` | ⚠️ 未使用 | ⚠️ 保留 | 交互优化 | 无 |
| `getPersonalizedRecommendations` | ✅ 在用 | ✅ | 核心功能，持续优化 | 无 |

### 2. 数据实体

```typescript
// 核心书籍数据
interface Book {
  id: string;                    // 本地唯一ID
  title: string;                 // 书名
  author: string;                // 作者
  publisher?: string;            // 出版社（豆瓣）
  category: string;              // 一级分类（AI生成）
  subcategory: string;           // 二级分类（AI生成）
  level: BookLevel;              // 难度等级（AI生成）
  status: BookStatus;            // 阅读状态
  userData?: UserProgress;       // 用户进度
  aiInsight?: AIInsight;         // AI解读
  coverColor?: string;           // 生成封面色
  rating?: number;               // 评分（豆瓣/用户）
  
  // === Phase 2 新增 ===
  doubanId?: string;             // 豆瓣ID
  isbn?: string;                 // ISBN
  publishYear?: string;          // 出版年份
  coverUrl?: string;             // 封面URL（本地blob）
  doubanRating?: number;         // 豆瓣评分
  doubanData?: DoubanBookData;   // 原始豆瓣数据
}

// 豆瓣数据（Phase 2）
interface DoubanBookData {
  id: string;
  title: string;
  subtitle?: string;
  author: string[];
  translator?: string[];
  publisher: string;
  pubdate: string;
  isbn13?: string;
  isbn10?: string;
  pages?: string;
  images: {
    small: string;
    medium: string;
    large: string;
  };
  rating: {
    average: string;
    numRaters: number;
  };
  summary: string;
  tags: { name: string; count: number }[];
}
```

### 3. 服务层设计

```
services/
├── ai/                          # AI 服务（现有迁移）
│   ├── bookClassifier.ts        # 书籍分类
│   ├── insightGenerator.ts      # 生成解读
│   ├── recommendationEngine.ts  # 推荐引擎
│   └── readingPathPlanner.ts    # 阅读路径规划
├── douban/                      # 豆瓣服务（Phase 2 新增）
│   ├── searchService.ts         # 书籍搜索
│   ├── coverService.ts          # 封面获取与缓存
│   └── versionSelector.ts       # 版本选择逻辑
├── storage/                     # 存储服务
│   ├── localStorage.ts          # 本地存储（Phase 1）
│   └── indexedDB.ts             # IndexedDB 封面存储
└── sync/                        # 同步服务（Phase 3）
    └── cloudSync.ts
```

---

## API 设计

### 豆瓣代理 API（后端提供）

```typescript
// 搜索书籍
GET /api/douban/search?q={keyword}
Response: DoubanBookData[]

// 获取封面（带缓存）
GET /api/douban/cover?url={doubanImageUrl}
Response: image/jpeg (或 base64)

// 获取书籍详情
GET /api/douban/book/{doubanId}
Response: DoubanBookData
```

### 内部 AI API

```typescript
// 批量分析（保持现有）
POST /api/ai/analyze-batch
Body: { titles: string[], existingCategories: string[] }

// 生成解读（保持现有）
POST /api/ai/insight
Body: { title: string, author: string, level: BookLevel }

// 个性化推荐（保持现有）
POST /api/ai/recommend
Body: { userRequest: string, library: Book[] }
```

---

## 前端组件架构

### 现有组件评估

| 组件 | 状态 | 修改需求 |
|------|------|---------|
| `Navbar` | ✅ 良好 | 无 |
| `LibraryView` | ✅ 良好 | 支持真实封面展示 |
| `BookCard` | ✅ 良好 | 增加封面图片模式 |
| `BookDetail` | ⚠️ 需优化 | 增加豆瓣信息展示、版本选择 |
| `AIAdvisor` | ✅ 良好 | 无 |
| `CategoryAdvisor` | ⚠️ 未使用 | 考虑整合或移除 |
| `StatsView` | ✅ 良好 | 无 |
| `IngestionWizard` | ⚠️ 需重写 | 增加版本选择流程 |
| `DataManagement` | ✅ 良好 | 无 |

### Phase 2 新增组件

```
components/
├── book/
│   ├── BookCover.tsx           # 封面组件（图片/生成色）
│   ├── BookVersionSelector.tsx # 版本选择器
│   └── DoubanInfo.tsx          # 豆瓣信息展示
├── import/
│   ├── ImportStepper.tsx       # 导入步骤条
│   ├── SearchBookStep.tsx      # 搜索书籍步骤
│   ├── SelectVersionStep.tsx   # 选择版本步骤
│   └── ConfirmImportStep.tsx   # 确认导入步骤
└── common/
    └── ImageWithFallback.tsx   # 带 fallback 的图片
```

---

## 数据流设计

### 添加书籍流程（Phase 2）

```
用户输入书名
    ↓
调用豆瓣搜索 API
    ↓
显示候选列表（书名、作者、出版社、年份）
    ↓
用户选择版本
    ↓
获取封面图片 → 缓存到 IndexedDB
    ↓
调用 AI 分析（分类、难度、解读）
    ↓
合并数据保存
```

### 书库展示优化

```
书库加载
    ↓
从 LocalStorage 读取书籍列表
    ↓
封面组件检查缓存
    ├── 有缓存 → 显示本地图片
    └── 无缓存 → 显示生成色封面
```

---

## 技术栈

### Phase 1: 纯前端 Demo
- **框架**: React + TypeScript + Vite
- **样式**: Tailwind CSS
- **动画**: Framer Motion
- **图标**: Phosphor Icons
- **存储**: LocalStorage + IndexedDB（封面）
- **AI**: DeepSeek API (客户端调用)

### Phase 2: 后端服务
- **Runtime**: Node.js / Deno / Cloudflare Workers
- **API**: Hono / Express
- **缓存**: Redis（可选）
- **图片处理**: Sharp / Canvas
- **部署**: Vercel / Cloudflare / VPS

### Phase 3: 完整方案
- **数据库**: PostgreSQL + Prisma
- **认证**: Clerk / Auth.js
- **同步**: WebSocket / Server-Sent Events

---

## 关键决策记录

### ADR 1: 封面存储方案
**决策**: 使用 IndexedDB 存储 base64 封面
**理由**: 
- MVP 阶段无需后端存储
- 每本书封面约 20-50KB，100 本书约 2-5MB，可接受
- 避免豆瓣防盗链问题

### ADR 2: AI 与豆瓣数据融合
**决策**: AI 负责主观分析，豆瓣负责客观数据
**分工**:
- 豆瓣: 书名、作者、出版社、年份、ISBN、封面、评分
- AI: 分类、难度、解读、推荐

### ADR 3: 版本选择策略
**决策**: 强制用户选择版本，不自动选择
**理由**:
- 同一本书可能有多个版本（年份、出版社不同）
- 用户需要确认具体版本
- 避免数据错误

### ADR 4: 封面 URL 处理策略
**决策**: 使用代理服务避免豆瓣防盗链
**实现**:
- 优先使用 `coverUrl` 字段（代理格式：`https://douban-proxy.203065.xyz/?url=xxx`）
- 后备使用 `doubanData.cover_url`（豆瓣原始 URL）
- 兼容旧数据 `doubanData.cover`
- 统一使用 `getBookCoverUrl()` 辅助函数获取

### ADR 5: 豆瓣数据字段映射
**决策**: 严格对齐后端返回的数据结构
**字段映射**:
| 前端使用 | 接口定义 | 说明 |
|---------|---------|------|
| `cover_url` | `cover_url` | 豆瓣封面 URL |
| `rating_score` | `rating_score` | 豆瓣评分 |
| `rating_count` | `rating_count` | 评分人数 |
| `publish_year` | `publish_year` | 出版年份（优先）|
| `pubdate` | `pubdate?` | 出版日期（可选）|

---

## 待办事项

### Phase 1（当前）
- [x] 优化前端 Demo 交互细节
- [x] 添加更多模拟数据场景
- [x] 完善错误处理 UI
- [x] 统一封面显示逻辑（代理格式优先）
- [x] 修复豆瓣数据字段名不一致问题
- [x] 添加全局 Toast 消息提示

### Phase 2（后端开发）
- [x] 搭建后端项目结构
- [x] 实现豆瓣代理 API
- [ ] 实现封面缓存服务
- [ ] 重写 IngestionWizard 组件
- [ ] 添加版本选择功能
- [ ] 实现 AI 流式输出

### Phase 3（联调优化）
- [ ] 数据迁移工具
- [ ] 性能监控
- [ ] 用户反馈收集
