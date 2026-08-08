/**
 * Exa API 集成测试脚本
 * 
 * 测试内容：
 * 1. web_search — 书评搜索 (book_reviews)
 * 2. web_search — 推荐书单搜索 (book_recommendations)
 * 3. web_search — 学术研究搜索 (academic_research)
 * 4. web_fetch — 获取网页详细内容
 * 5. 缓存命中测试
 */

// 加载环境变量
import 'dotenv/config';

import {
  isWebSearchEnabled,
  executeWebTool,
  clearWebCache,
} from './src/services/webSearchService.ts';

const SEP = '='.repeat(60);
const SUB = '-'.repeat(40);

async function main() {
  console.log(SEP);
  console.log('Exa API 集成测试');
  console.log(SEP);

  // 0. 检查配置
  if (!isWebSearchEnabled()) {
    console.error('❌ EXA_API_KEY 未配置，退出');
    process.exit(1);
  }
  console.log('✅ EXA_API_KEY 已配置\n');

  // 1. 测试 web_search — book_reviews
  console.log(SUB);
  console.log('测试 1: web_search (book_reviews)');
  console.log(SUB);
  const search1 = await executeWebTool('web_search', {
    query: '深度学习入门 书评 推荐',
    category: 'book_reviews',
    numResults: 3,
  });
  const result1 = JSON.parse(search1);
  console.log(`  结果数: ${result1.totalResults}`);
  console.log(`  成本: ${result1.searchCost || 'N/A'}`);
  if (result1.results) {
    for (const r of result1.results) {
      console.log(`  [${r.index}] ${r.title}`);
      console.log(`      URL: ${r.url}`);
      if (r.summary) console.log(`      摘要: ${r.summary.slice(0, 100)}...`);
      if (r.highlights) console.log(`      Highlights: ${r.highlights[0]?.slice(0, 100)}...`);
    }
  }
  if (result1.error) {
    console.log(`  ❌ 错误: ${result1.error}`);
  }
  console.log('');

  // 2. 测试 web_search — book_recommendations
  console.log(SUB);
  console.log('测试 2: web_search (book_recommendations)');
  console.log(SUB);
  const search2 = await executeWebTool('web_search', {
    query: '2024年最佳编程入门书籍推荐',
    category: 'book_recommendations',
    numResults: 3,
  });
  const result2 = JSON.parse(search2);
  console.log(`  结果数: ${result2.totalResults}`);
  console.log(`  成本: ${result2.searchCost || 'N/A'}`);
  if (result2.results) {
    for (const r of result2.results) {
      console.log(`  [${r.index}] ${r.title}`);
      console.log(`      URL: ${r.url}`);
      if (r.summary) console.log(`      摘要: ${r.summary.slice(0, 100)}...`);
    }
  }
  if (result2.error) {
    console.log(`  ❌ 错误: ${result2.error}`);
  }
  console.log('');

  // 3. 测试 web_search — academic_research
  console.log(SUB);
  console.log('测试 3: web_search (academic_research)');
  console.log(SUB);
  const search3 = await executeWebTool('web_search', {
    query: 'large language models reasoning capabilities',
    category: 'academic_research',
    numResults: 3,
  });
  const result3 = JSON.parse(search3);
  console.log(`  结果数: ${result3.totalResults}`);
  console.log(`  成本: ${result3.searchCost || 'N/A'}`);
  if (result3.results) {
    for (const r of result3.results) {
      console.log(`  [${r.index}] ${r.title}`);
      console.log(`      URL: ${r.url}`);
      if (r.author) console.log(`      作者: ${r.author}`);
      if (r.publishedDate) console.log(`      发布日期: ${r.publishedDate}`);
    }
  }
  if (result3.error) {
    console.log(`  ❌ 错误: ${result3.error}`);
  }
  console.log('');

  // 4. 测试缓存命中
  console.log(SUB);
  console.log('测试 4: 缓存命中测试 (重复搜索同一关键词)');
  console.log(SUB);
  const startCache = Date.now();
  const search4 = await executeWebTool('web_search', {
    query: '深度学习入门 书评 推荐',
    category: 'book_reviews',
    numResults: 3,
  });
  const cacheElapsed = Date.now() - startCache;
  const result4 = JSON.parse(search4);
  console.log(`  耗时: ${cacheElapsed}ms (应该 < 10ms 表示缓存命中)`);
  console.log(`  结果数: ${result4.totalResults}`);
  console.log('');

  // 5. 测试 web_fetch
  console.log(SUB);
  console.log('测试 5: web_fetch (获取网页内容)');
  console.log(SUB);
  // 使用前面搜索结果中的 URL
  const fetchUrl = result1.results?.[0]?.url || result2.results?.[0]?.url;
  if (fetchUrl) {
    const fetchResult = await executeWebTool('web_fetch', {
      urls: [fetchUrl],
      maxCharacters: 3000,
    });
    const fetchParsed = JSON.parse(fetchResult);
    console.log(`  获取页面数: ${fetchParsed.totalFetched}`);
    if (fetchParsed.pages) {
      for (const p of fetchParsed.pages) {
        console.log(`  [${p.index}] ${p.title}`);
        console.log(`      URL: ${p.url}`);
        if (p.text) console.log(`      文本前200字: ${p.text.slice(0, 200)}...`);
      }
    }
    if (fetchParsed.error) {
      console.log(`  ❌ 错误: ${fetchParsed.error}`);
    }
  } else {
    console.log('  ⚠️ 跳过（前面搜索无结果可用）');
  }
  console.log('');

  // 6. 测试未知工具
  console.log(SUB);
  console.log('测试 6: 未知工具处理');
  console.log(SUB);
  const unknownResult = await executeWebTool('web_unknown', {});
  console.log(`  结果: ${unknownResult}`);
  console.log('');

  // 7. 清空缓存
  console.log(SUB);
  console.log('测试 7: 清空缓存');
  console.log(SUB);
  clearWebCache();
  console.log('  ✅ 缓存已清空');

  console.log(SEP);
  console.log('测试完成');
  console.log(SEP);
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
