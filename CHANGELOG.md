# 更新日志

## [Unreleased]

### Added
- 添加全局 Toast 消息提示组件 (`components/Toast.tsx`)
- 添加书籍难度可视化组件 (`components/DifficultyBadge.tsx`)
- 添加阅读统计视图 (`components/StatsView.tsx`)
- 添加阅读时间线和热力图组件
- 添加 `getBookCoverUrl()` 和 `hasBookCover()` 辅助函数统一处理封面 URL
- 添加调试页面 `check-storage.html` 用于检查 localStorage 数据结构

### Changed
- 优化书籍详情页 (`BookDetail.tsx`)：
  - 添加豆瓣数据 Tab 展示评分、出版社、页数等信息
  - 添加阅读状态统计（在读/已读/想读）
  - 添加 AI 生成中状态提示
  - 修复 `keyChapters` 渲染报错
- 统一所有组件的封面显示逻辑，优先使用代理格式 URL
- 优化 AI 提示词，传入豆瓣元数据提高解读准确性
- 修复 `geminiService.ts` 数据提取逻辑，正确返回 `result.data`

### Fixed
- 修复豆瓣数据字段名不一致问题：
  - `cover` → `cover_url`
  - `rating` → `rating_score`
  - `ratingCount` → `rating_count`
- 修复 `pubdate` 可选性，兼容 `publish_year`
- 移除不存在的 `tags` 字段依赖
- 修复封面在部分组件不显示的问题

### Technical
- 后端服务 (`backend/`)：
  - 实现豆瓣 API 代理服务
  - 实现缓存优先策略（cache.json + 用户缓存）
  - 集成 douban_mini 抓取器
  - 添加智能查找接口 `/api/douban/find`
