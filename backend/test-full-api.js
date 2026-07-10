/**
 * 全量 API 测试脚本
 * 
 * 测试所有后端 API 端点，包括：
 * 1. 健康检查
 * 2. AI 服务（分类、推荐、解读、路径规划、整理）
 * 3. 豆瓣 API（搜索、详情、封面）
 */

const BASE_URL = 'http://localhost:3001';

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

let passCount = 0;
let failCount = 0;

function log(title, status, details = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '→';
  const color = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow;
  console.log(`${color}${icon} ${title}${colors.reset}`);
  if (details) {
    console.log(`  ${details}`);
  }
}

async function test(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    
    const duration = Date.now() - startTime;
    const data = await response.json().catch(() => null);
    
    return {
      success: response.ok,
      status: response.status,
      duration,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

// ==================== 测试套件 ====================

async function testHealth() {
  console.log(`\n${colors.cyan}=== 健康检查 ===${colors.reset}`);
  
  const result = await test('/api/health');
  
  if (result.success && result.data?.status === 'ok') {
    log('Health Check', 'PASS', `响应时间: ${result.duration}ms`);
    passCount++;
  } else {
    log('Health Check', 'FAIL', result.error || `状态: ${result.status}`);
    failCount++;
  }
}

async function testAIClassification() {
  console.log(`\n${colors.cyan}=== AI 书籍分类 ===${colors.reset}`);
  
  const result = await test('/api/ai/classify', {
    method: 'POST',
    body: {
      titles: ['深入理解计算机系统', 'JavaScript高级程序设计', '三体'],
      existingCategories: ['技术', '文学']
    }
  });
  
  if (result.success && Array.isArray(result.data)) {
    log('Batch Classification', 'PASS',
      `分类了 ${result.data.length} 本书，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Batch Classification', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testAIRecommendation() {
  console.log(`\n${colors.cyan}=== AI 阅读推荐 ===${colors.reset}`);
  
  const mockLibrary = [
    {
      id: '1',
      title: '设计模式：可复用面向对象软件的基础',
      author: 'GoF',
      category: '技术',
      subcategory: '软件工程',
      level: 'Advanced',
      status: 'unread',
      tags: ['设计模式', '面向对象'],
      addedAt: new Date().toISOString()
    },
    {
      id: '2',
      title: 'Clean Code',
      author: 'Robert C. Martin',
      category: '技术',
      subcategory: '软件工程',
      level: 'Intermediate',
      status: 'reading',
      progress: 30,
      tags: ['代码质量', '重构'],
      addedAt: new Date().toISOString()
    }
  ];
  
  const result = await test('/api/ai/recommend', {
    method: 'POST',
    body: {
      library: mockLibrary,
      mood: 'focused',
      context: '想提升代码质量',
      categoryContext: {
        category: '技术',
        subcategory: '软件工程'
      }
    }
  });
  
  if (result.success && result.data?.libraryMatches) {
    log('Reading Recommendation', 'PASS',
      `书库匹配 ${result.data.libraryMatches.length} 本，外部推荐 ${result.data.externalMatches?.length || 0} 本，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Reading Recommendation', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testAIInsight() {
  console.log(`\n${colors.cyan}=== AI 书籍解读 ===${colors.reset}`);
  
  const result = await test('/api/ai/insight', {
    method: 'POST',
    body: {
      title: '黑客与画家',
      author: 'Paul Graham',
      level: 'Intermediate',
      category: '技术',
      subcategory: '编程文化'
    }
  });
  
  if (result.success && (result.data?.summary || result.data?.content)) {
    log('Book Insight', 'PASS', `耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Book Insight', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testAIReadingPath() {
  console.log(`\n${colors.cyan}=== AI 阅读路径规划 ===${colors.reset}`);
  
  const mockBooks = [
    { id: '1', title: 'JavaScript基础教程', author: 'John', level: 'Basic', status: 'completed' },
    { id: '2', title: 'JavaScript高级程序设计', author: 'Matt', level: 'Advanced', status: 'unread' },
    { id: '3', title: 'You Don\'t Know JS', author: 'Kyle', level: 'Expert', status: 'unread' }
  ];
  
  const result = await test('/api/ai/reading-path', {
    method: 'POST',
    body: {
      books: mockBooks,
      category: '技术',
      subcategory: 'JavaScript',
      customRequirements: '系统学习 JavaScript'
    }
  });
  
  if (result.success && result.data?.sortedBookIds) {
    log('Reading Path', 'PASS',
      `规划 ${result.data.sortedBookIds.length} 本书，预计 ${result.data.estimatedTotalDays} 天，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Reading Path', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testAIReorganize() {
  console.log(`\n${colors.cyan}=== AI 智能整理 ===${colors.reset}`);
  
  const mockBooks = [
    { id: '1', title: '三体', author: '刘慈欣', category: '科幻', subcategory: '硬科幻' },
    { id: '2', title: '百年孤独', author: '马尔克斯', category: '文学', subcategory: '魔幻现实主义' },
    { id: '3', title: '深入理解计算机系统', author: 'Randal', category: '计算机', subcategory: '系统' }
  ];
  
  const result = await test('/api/ai/reorganize', {
    method: 'POST',
    body: { books: mockBooks }
  });
  
  if (result.success && result.data) {
    const mappingCount = Object.keys(result.data).length;
    log('Library Reorganize', 'PASS',
      `整理了 ${mappingCount} 本书，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Library Reorganize', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testDoubanSearch() {
  console.log(`\n${colors.cyan}=== 豆瓣搜索 ===${colors.reset}`);
  
  const result = await test('/api/douban/search?q=三体');
  
  if (result.success && Array.isArray(result.data)) {
    log('Douban Search', 'PASS',
      `找到 ${result.data.length} 本书，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Douban Search', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testDoubanDetail() {
  console.log(`\n${colors.cyan}=== 豆瓣详情 ===${colors.reset}`);
  
  // 先搜索获取 ID
  const searchResult = await test('/api/douban/search?q=三体');
  if (!searchResult.success || !searchResult.data?.books?.[0]?.id) {
    log('Douban Detail', 'SKIP', '无法获取书籍 ID');
    return;
  }
  
  const bookId = searchResult.data.books[0].id;
  const result = await test(`/api/douban/book/${bookId}`);
  
  if (result.success && result.data?.title) {
    log('Douban Detail', 'PASS',
      `"${result.data.title}"，耗时: ${result.duration}ms`);
    console.log(`  作者: ${result.data.author?.join(', ')}`);
    console.log(`  出版社: ${result.data.publisher}`);
    console.log(`  评分: ${result.data.rating?.average} (${result.data.rating?.numRaters}人评价)`);
    passCount++;
  } else {
    log('Douban Detail', 'FAIL', result.error || JSON.stringify(result.data));
    failCount++;
  }
}

async function testDoubanCover() {
  console.log(`\n${colors.cyan}=== 豆瓣封面 ===${colors.reset}`);
  
  // 先搜索获取封面 URL
  const searchResult = await test('/api/douban/search?q=三体');
  if (!searchResult.success || !searchResult.data?.books?.[0]?.images?.medium) {
    log('Douban Cover', 'SKIP', '无法获取封面 URL');
    return;
  }
  
  const coverUrl = searchResult.data.books[0].images.medium;
  const result = await test(`/api/douban/cover?url=${encodeURIComponent(coverUrl)}`);
  
  if (result.success && result.status === 200) {
    log('Douban Cover', 'PASS',
      `获取封面图片，耗时: ${result.duration}ms`);
    passCount++;
  } else {
    log('Douban Cover', 'FAIL', result.error || `状态: ${result.status}`);
    failCount++;
  }
}

// ==================== 主函数 ====================

async function runAllTests() {
  console.log(`${colors.blue}
╔══════════════════════════════════════════════════════════╗
║           DeepRead API 全量测试                          ║
║           Model: deepseek-v4-flash-plus                  ║
╚══════════════════════════════════════════════════════════╝
${colors.reset}`);
  
  const startTime = Date.now();
  
  // 基础测试
  await testHealth();
  
  // AI 服务测试
  await testAIClassification();
  await testAIRecommendation();
  await testAIInsight();
  await testAIReadingPath();
  await testAIReorganize();
  
  // 豆瓣 API 测试
  await testDoubanSearch();
  await testDoubanDetail();
  await testDoubanCover();
  
  const totalDuration = Date.now() - startTime;
  
  // 测试报告
  console.log(`\n${colors.blue}══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}测试完成！${colors.reset}`);
  console.log(`  总耗时: ${totalDuration}ms`);
  console.log(`  ${colors.green}通过: ${passCount}${colors.reset}`);
  console.log(`  ${colors.red}失败: ${failCount}${colors.reset}`);
  console.log(`  总计: ${passCount + failCount}`);
  
  if (failCount === 0) {
    console.log(`\n${colors.green}✓ 所有测试通过！${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}⚠ ${failCount} 个测试失败，请检查日志${colors.reset}`);
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error(`${colors.red}测试运行失败: ${error.message}${colors.reset}`);
  process.exit(1);
});
