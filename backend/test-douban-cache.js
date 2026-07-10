/**
 * 豆瓣缓存机制测试脚本
 * 
 * 测试场景：
 * 1. 查询缓存中已有的书（应该很快）
 * 2. 查询缓存中没有的书（需要实时抓取）
 * 3. 再次查询同一本书（应该命中缓存）
 */

const API_BASE = 'http://localhost:3001/api';

// 测试书籍
const TEST_BOOKS = {
  // 应该在 cache.json 中的书（计算机类经典）
  cached: '深入理解计算机系统',
  // 可能不在缓存中的书（随机选择）
  uncached: 'Python编程：从入门到实践',
  // 另一本可能不在缓存中的书
  uncached2: '福格行为模型',
};

async function testFindBook(title, description) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试: ${description}`);
  console.log(`书名: ${title}`);
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
  console.log('🚀 开始豆瓣缓存机制测试');
  console.log(`API地址: ${API_BASE}`);

  // 先查看缓存状态
  await testCacheStats();

  // 测试1: 缓存中应该有的书
  const result1 = await testFindBook(TEST_BOOKS.cached, '1. 缓存中已有的书（预期：很快）');

  // 测试2: 缓存中没有的书
  const result2 = await testFindBook(TEST_BOOKS.uncached, '2. 缓存中没有的书（预期：较慢，需要抓取）');

  // 测试3: 再次查询同一本书（应该命中缓存）
  if (result2) {
    await testFindBook(TEST_BOOKS.uncached, '3. 再次查询同一本书（预期：很快，命中缓存）');
  }

  // 测试4: 另一本新书
  await testFindBook(TEST_BOOKS.uncached2, '4. 另一本新书（预期：较慢）');

  // 最后查看缓存状态
  await testCacheStats();

  console.log(`\n${'='.repeat(60)}`);
  console.log('测试完成！');
  console.log('='.repeat(60));

  // 性能对比
  if (result1 && result2) {
    console.log('\n📊 性能对比:');
    console.log(`   缓存命中: ${result1.duration}ms`);
    console.log(`   实时抓取: ${result2.duration}ms`);
    console.log(`   加速比: ${(result2.duration / result1.duration).toFixed(1)}x`);
  }
}

// 运行测试
runTests().catch(console.error);
