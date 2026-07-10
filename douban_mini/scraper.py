"""豆瓣书籍极简抓取器 — suggest API 搜索 + 详情页结构化提取。
可用代理：http://202607092247005606:jojzjen1@a963.zdtps.com:21166

用法:
    import asyncio
    from douban_mini import DoubanMini

    async def main():
        dm = DoubanMini(proxy_url="http://user:pass@host:port")
        await dm.start()

        # 搜索
        results = await dm.search("福格行为模型")
        print(results)

        # 获取详情
        book = await dm.get_book(results[0]["id"])
        print(book)

        await dm.stop()

    asyncio.run(main())
"""
import asyncio
import json
import re
import urllib.parse
from dataclasses import dataclass, field, asdict
from typing import Optional

import aiohttp
from bs4 import BeautifulSoup


SUGGEST_URL = "https://book.douban.com/j/subject_suggest?q={query}"
BOOK_URL = "https://book.douban.com/subject/{book_id}/"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"


# ── 数据结构 ──

@dataclass
class SearchResult:
    id: str
    title: str
    author: str = ""
    year: str = ""
    cover_url: str = ""
    url: str = ""


@dataclass
class Comment:
    user_name: str = ""
    rating: str = ""
    date: str = ""
    content: str = ""
    votes: int = 0


@dataclass
class Book:
    id: str = ""
    title: str = ""
    subtitle: str = ""
    cover_url: str = ""
    author: list[str] = field(default_factory=list)
    translator: list[str] = field(default_factory=list)
    publisher: str = ""
    producer: str = ""
    publish_year: str = ""
    isbn: str = ""
    pages: Optional[int] = None
    binding: str = ""
    price: str = ""
    series: str = ""
    original_title: str = ""
    rating_score: Optional[float] = None
    rating_count: Optional[int] = None
    rating_distribution: dict = field(default_factory=dict)
    summary: str = ""
    reading_status: dict = field(default_factory=dict)
    url: str = ""
    comments: list[Comment] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ── 核心类 ──

class DoubanMini:
    """极简豆瓣书籍抓取器

    - 搜索: suggest API (无cookie, 隧道代理)
    - 详情: book.douban.com/subject/{id} (无cookie, 隧道代理)
    - 不存储任何 cookie, 不依赖 Playwright
    """

    def __init__(
        self,
        proxy_url: str = "",
        timeout: int = 10,
        max_retries: int = 3,
    ):
        self._proxy_url = proxy_url or None
        self._timeout = timeout
        self._max_retries = max_retries
        self._session: Optional[aiohttp.ClientSession] = None

    async def start(self):
        connector = aiohttp.TCPConnector(force_close=True, limit=0, ssl=False)
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self._timeout),
            connector=connector,
            cookie_jar=aiohttp.DummyCookieJar(),  # 不存储 cookie
        )

    async def stop(self):
        if self._session:
            await self._session.close()
            self._session = None

    async def __aenter__(self):
        await self.start()
        return self

    async def __aexit__(self, *args):
        await self.stop()

    # ── 搜索 ──

    async def search(self, keyword: str) -> list[SearchResult]:
        """搜索书籍，返回结果列表。

        通过豆瓣 suggest API 搜索，走隧道代理，无 cookie。
        """
        clean = _clean_keyword(keyword)
        url = SUGGEST_URL.format(query=urllib.parse.quote(clean))
        headers = {
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://book.douban.com/",
        }
        proxy_kw = {"proxy": self._proxy_url} if self._proxy_url else {}

        try:
            async with self._session.get(
                url, headers=headers, allow_redirects=False, **proxy_kw
            ) as resp:
                if resp.status != 200:
                    return []
                text = await resp.text("utf-8", errors="replace")
                if not text.lstrip().startswith("["):
                    return []
                data = json.loads(text)
        except Exception:
            return []

        results = []
        seen = set()
        for item in data:
            if item.get("type") not in ("b", "book"):
                continue
            bid = item.get("id", "")
            if not bid or bid in seen:
                continue
            seen.add(bid)
            results.append(SearchResult(
                id=bid,
                title=item.get("title", ""),
                author=item.get("author_name", ""),
                year=item.get("year", ""),
                cover_url=item.get("pic", ""),
                url=item.get("url", f"https://book.douban.com/subject/{bid}/"),
            ))
        return results

    # ── 详情 ──

    async def get_book(self, book_id: str) -> Optional[Book]:
        """获取书籍详情 + 短评。

        从 https://book.douban.com/subject/{id}/ 提取结构化数据。
        """
        url = BOOK_URL.format(book_id=book_id)
        html = await self._fetch_with_retry(url)
        if not html:
            return None
        return _parse_book(html, book_id)

    # ── 内部 ──

    async def _fetch_with_retry(self, url: str) -> Optional[str]:
        """带重试的 HTTP GET，302 视为限流重试"""
        headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Referer": "https://book.douban.com/",
        }
        proxy_kw = {"proxy": self._proxy_url} if self._proxy_url else {}

        for attempt in range(self._max_retries):
            try:
                async with self._session.get(
                    url, headers=headers, allow_redirects=False, **proxy_kw
                ) as resp:
                    if 300 <= resp.status < 400:
                        # 302 = 被限流，等 1 秒重试
                        await asyncio.sleep(1)
                        continue
                    if resp.status != 200:
                        return None
                    html = await resp.text("utf-8", errors="replace")
                    # 校验是否是真实详情页（非登录页）
                    if 'property="v:itemreviewed"' not in html and 'id="info"' not in html:
                        await asyncio.sleep(1)
                        continue
                    return html
            except (aiohttp.ClientError, asyncio.TimeoutError):
                await asyncio.sleep(1)
                continue
        return None


# ── 解析函数 ──

def _clean_keyword(keyword: str) -> str:
    """去掉括号版本信息"""
    clean = re.sub(r'[（(].*?[)）]', '', keyword).strip()
    return clean or keyword


def _parse_book(html: str, book_id: str) -> Book:
    soup = BeautifulSoup(html, "lxml")
    book = Book(id=book_id, url=BOOK_URL.format(book_id=book_id))

    # 标题
    title_el = soup.select_one('h1 span[property="v:itemreviewed"]') or soup.select_one("h1 span")
    if title_el:
        book.title = title_el.text.strip()

    # 封面
    cover = soup.select_one("#mainpic img")
    if cover:
        book.cover_url = cover.get("src", "")

    # 信息区
    _parse_info(soup, book)

    # 评分
    score_el = soup.select_one(".rating_num")
    if score_el:
        try:
            book.rating_score = float(score_el.text.strip())
        except ValueError:
            pass

    count_el = soup.select_one('.rating_people span[property="v:votes"]')
    if count_el:
        try:
            book.rating_count = int(re.sub(r"\D", "", count_el.text))
        except ValueError:
            pass

    # 评分分布
    text = soup.get_text()
    for star, pct in re.findall(r"(\d)星\s*([\d.]+)%", text):
        book.rating_distribution[str(star)] = float(pct)

    # 简介
    link_report = soup.select_one("#link-report")
    if link_report:
        full = link_report.select_one(".all .intro") or link_report.select_one(".all")
        if full:
            book.summary = full.get_text("\n", strip=True)
        else:
            short = link_report.select_one(".intro")
            if short:
                book.summary = short.get_text("\n", strip=True)

    # 阅读状态
    for key, pat in [("reading", r"([\d,]+)人在读"), ("read", r"([\d,]+)人读过"), ("want_to_read", r"([\d,]+)人想读")]:
        m = re.search(pat, text)
        if m:
            book.reading_status[key] = int(m.group(1).replace(",", ""))

    # 短评（从详情页直接提取）
    for item in soup.select(".comment-item"):
        c = _parse_comment(item)
        if c and c.content:
            book.comments.append(c)

    return book


def _parse_info(soup: BeautifulSoup, book: Book) -> None:
    field_map = {
        "作者": "author", "译者": "translator", "出版社": "publisher",
        "出品方": "producer", "出版年": "publish_year", "ISBN": "isbn",
        "页数": "pages", "装帧": "binding", "定价": "price",
        "原作名": "original_title", "丛书": "series", "副标题": "subtitle",
    }

    info_div = soup.select_one("#info")
    if not info_div:
        return

    # 用文本+正则提取，兼容嵌套 span 结构
    # 策略: 找所有 span.pl 标签，取其文本作为 label，
    #       然后收集同层级后续兄弟节点直到 br 或下一个 span.pl
    for pl in info_div.select("span.pl"):
        label = pl.text.strip().rstrip(":：").strip()
        if label not in field_map:
            continue

        values: list[str] = []
        nxt = pl.next_sibling
        while nxt:
            if hasattr(nxt, "name"):
                if nxt.name == "br":
                    break
                if nxt.name == "span" and "pl" in nxt.get("class", []):
                    break
                if nxt.name == "a":
                    t = nxt.text.strip()
                    if t:
                        values.append(t)
                elif nxt.name == "span" and "pl" not in nxt.get("class", []):
                    # 嵌套 span 容器，深入找 <a> 标签
                    for a in nxt.select("a"):
                        t = a.text.strip()
                        if t:
                            values.append(t)
                    if not nxt.select("a"):
                        t = nxt.text.strip()
                        if t and t != label:
                            values.append(t)
                elif hasattr(nxt, "string") and nxt.string:
                    t = nxt.string.strip()
                    if t and t not in (":", "："):
                        values.append(t)
            elif hasattr(nxt, "string") and nxt.string:
                t = nxt.string.strip()
                if t and t not in (":", "："):
                    values.append(t)
            nxt = nxt.next_sibling

        if values:
            _set_field(book, field_map, label, values)


def _set_field(book: Book, field_map: dict, label: str, values: list[str]) -> None:
    field = field_map.get(label)
    if not field or not values:
        return
    joined = "".join(values).strip()
    if not joined:
        return
    if field in ("author", "translator"):
        for part in re.split(r"[/、,，]", joined):
            p = part.strip()
            if p:
                getattr(book, field).append(p)
    elif field == "pages":
        try:
            book.pages = int(re.search(r"\d+", joined).group())
        except (ValueError, AttributeError):
            pass
    else:
        setattr(book, field, joined)


def _parse_comment(item) -> Optional[Comment]:
    c = Comment()

    user_el = item.select_one(".comment-info a")
    if user_el:
        c.user_name = user_el.text.strip()

    star_el = item.select_one('[class*="allstar"]')
    if star_el:
        c.rating = star_el.get("title", "")

    date_el = item.select_one(".comment-time")
    if date_el:
        c.date = date_el.text.strip()

    content_el = item.select_one(".short") or item.select_one(".comment-content")
    if content_el:
        c.content = content_el.text.strip()

    votes_el = item.select_one(".votes") or item.select_one(".vote-count")
    if votes_el:
        try:
            c.votes = int(re.search(r"\d+", votes_el.text).group())
        except (ValueError, AttributeError):
            pass

    return c
