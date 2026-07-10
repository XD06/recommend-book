# douban_mini — 豆瓣书籍极简抓取器

零依赖（仅需 aiohttp + bs4），无 Playwright，无缓存，适合移植到其他项目。

## 核心功能

1. **搜索书籍** — 通过豆瓣 suggest API 获取书名对应的 subject ID
2. **提取详情** — 从 `book.douban.com/subject/{id}` 解析结构化数据（书名、作者、评分、简介、短评等）

## 特性

- 不存储任何 Cookie，不带 bid，完全匿名访问
- 支持隧道代理（推荐，避免被限流）
- 302 重定向自动重试
- 从详情页直接提取短评，无需额外请求
- 单文件核心，复制即用

## 安装

```bash
pip install aiohttp beautifulsoup4 lxml
```

## 快速开始

```python
import asyncio
from douban_mini import DoubanMini

async def main():
    # 推荐使用隧道代理
    dm = DoubanMini(proxy_url="http://user:pass@host:port")
    await dm.start()

    # 搜索
    results = await dm.search("福格行为模型")
    for r in results:
        print(f"  id={r.id}  {r.title}  {r.author}  {r.year}")

    # 获取详情
    book = await dm.get_book(results[0].id)
    print(f"书名: {book.title}")
    print(f"作者: {book.author}")
    print(f"评分: {book.rating_score} ({book.rating_count}人)")
    print(f"简介: {book.summary[:100]}")
    print(f"短评: {len(book.comments)}条")
    for c in book.comments:
        print(f"  [{c.rating}] {c.user_name}: {c.content[:50]}")

    await dm.stop()

asyncio.run(main())
```

## 上下文管理器用法

```python
async with DoubanMini(proxy_url="http://user:pass@host:port") as dm:
    results = await dm.search("三体")
    book = await dm.get_book(results[0].id)
    print(book.to_dict())  # 转为 JSON 可序列化的 dict
```

## API

### `DoubanMini(proxy_url="", timeout=10, max_retries=3)`

| 参数 | 类型 | 说明 |
|------|------|------|
| `proxy_url` | `str` | 隧道代理地址，格式 `http://user:pass@host:port` |
| `timeout` | `int` | 单次请求超时（秒） |
| `max_retries` | `int` | 302/超时重试次数 |

### `await dm.search(keyword) -> list[SearchResult]`

搜索书籍，返回结果列表。

### `await dm.get_book(book_id) -> Book | None`

获取书籍详情（含短评），失败返回 None。

### `Book.to_dict() -> dict`

转为 JSON 可序列化字典。

## 返回数据结构

```json
{
  "id": "35594496",
  "title": "福格行为模型",
  "subtitle": "",
  "cover_url": "https://...",
  "author": ["[美] B.J.福格"],
  "translator": [],
  "publisher": "湛庐文化/天津科学技术出版社",
  "publish_year": "2021-1",
  "isbn": "9787557690850",
  "pages": 256,
  "binding": "平装",
  "price": "69.90元",
  "series": "",
  "original_title": "Tiny Habits",
  "rating_score": 8.7,
  "rating_count": 7080,
  "rating_distribution": {"5": 68.2, "4": 24.1, "3": 6.3, "2": 0.9, "1": 0.5},
  "summary": "...",
  "reading_status": {"reading": 1234, "read": 5678, "want_to_read": 9012},
  "url": "https://book.douban.com/subject/35594496/",
  "comments": [
    {
      "user_name": "张三",
      "rating": "推荐",
      "date": "2021-03-15",
      "content": "非常好的书...",
      "votes": 42
    }
  ]
}
```

## 文件结构

```
douban_mini/
├── __init__.py        # 导出 DoubanMini
├── scraper.py         # 全部核心代码（HTTP + 解析）
├── requirements.txt   # 依赖
└── README.md
```

## 移植说明

只需复制 `douban_mini/` 目录到你的项目，安装 3 个依赖即可。`scraper.py` 是单文件核心，无外部项目依赖。
