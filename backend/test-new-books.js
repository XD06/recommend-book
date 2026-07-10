/**
 * 新书籍测试脚本
 * 
 * 测试书籍：
 * 1. 哲学家的最后一课
 * 2. 智能简史
 * 3. 如何快速了解一个行业
 */

const API_BASE = 'http://localhost:3001/api';

const NEW_BOOKS = [
  '哲学家的最后一课',
  '智能简史',
  '如何快速了解一个行业',
];

async function testFindBook(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试新书: ${title}`);
  console.log('='.repeat(60));

  const startTime = Date.now();
  
  try {
    const response = await fetch(`${API_BASE}/douban/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    const duration = Date.now() - startTime;

    if (response.status === 404) {
      console.log(`❌ 未找到书籍 (${duration}ms)`);
      return null;
    }

    if (!response.ok) {
      const error = await response.json();
      console.log(`❌ 错误: ${error.error} (${duration}ms)`);
      return null;
    }

    const data = await response.json();
    const book = data.data.book;
    const fromCache = data.meta?.fromCache;

    console.log(`✅ 成功 (${duration}ms) ${fromCache ? '[缓存]' : '[实时抓取]'}`);
    console.log(`   豆瓣ID: ${book.id}`);
    console.log(`   标题: ${book.title}`);
    console.log(`   副标题: ${book.subtitle || '无'}`);
    console.log(`   作者: ${book.author?.join(', ')}`);
    console.log(`   出版社: ${book.publisher}`);
    console.log(`   评分: ${book.rating_score} (${book.rating_count}人)`);
    console.log(`   出版年份: ${book.publish_year || book.pubdate}`);
    console.log(`   页数: ${book.pages}`);
    console.log(`   ISBN: ${book.isbn}`);
    console.log(`   封面: ${book.cover_url ? '有' : '无'}`);
    console.log(`   简介: ${book.summary?.substring(0, 100)}...`);

    return { book, duration, fromCache };
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return null;
  }
}

async function testCacheStats() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('缓存统计');
  console.log('='.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/douban/cache/stats`);
    const data = await response.json();
    console.log('当前缓存状态:', data.data);
  } catch (error) {
    console.log('获取缓存统计失败:', error.message);
  }
}

async function runTests() {
  console.log('🚀 开始新书籍测试');
  console.log(`API地址: ${API_BASE}`);

  // 先查看缓存状态
  await testCacheStats();

  // 测试每本新书
  const results = [];
  for (const title of NEW_BOOKS) {
    const result = await testFindBook(title);
    if (result) results.push({ title, ...result });
    
    // 间隔2秒，避免触发限流
    if (title !== NEW_BOOKS[NEW_BOOKS.length - 1]) {
      console.log('\n⏳ 等待2秒...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // 最后查看缓存状态
  await testCacheStats();

  console.log(`\n${'='.repeat(60)}`);
  console.log('测试完成！');
  console.log('='.repeat(60));

  // 汇总
  if (results.length > 0) {
    console.log('\n📊 结果汇总:');
    results.forEach(r => {
      console.log(`   ${r.title}: ${r.duration}ms ${r.fromCache ? '[缓存]' : '[抓取]'}`);
    });
    const avgTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    console.log(`   平均耗时: ${avgTime.toFixed(0)}ms`);
  }
}

// 运行测试
runTests().catch(console.error);
