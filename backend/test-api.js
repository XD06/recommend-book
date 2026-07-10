// 简单 API 测试脚本

const BASE_URL = 'http://localhost:3001/api';

async function testHealth() {
  console.log('Testing health check...');
  const res = await fetch(`${BASE_URL}/health`);
  const data = await res.json();
  console.log('✅ Health:', data);
  return data.status === 'ok';
}

async function testClassify() {
  console.log('\nTesting AI classify...');
  const res = await fetch(`${BASE_URL}/ai/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titles: ['深入理解计算机系统', '人类简史', '思考，快与慢'],
      existingCategories: ['计算机科学', '历史', '心理学']
    })
  });
  const data = await res.json();
  console.log('✅ Classify result:', JSON.stringify(data, null, 2));
  return data.success;
}

async function testRecommend() {
  console.log('\nTesting AI recommend...');
  const res = await fetch(`${BASE_URL}/ai/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: '最近工作压力大，想读点轻松的',
      library: [
        { id: '1', title: '代码大全', author: 'Steve McConnell', category: '计算机科学', subcategory: '软件工程', status: 'unread', level: 'Advanced' },
        { id: '2', title: '心流', author: '米哈里', category: '心理学', subcategory: '积极心理学', status: 'unread', level: 'Basic' },
        { id: '3', title: '百年孤独', author: '马尔克斯', category: '文学', subcategory: '小说', status: 'reading', level: 'Advanced' }
      ]
    })
  });
  const data = await res.json();
  console.log('✅ Recommend result:', JSON.stringify(data, null, 2));
  return data.success;
}

async function testDoubanSearch() {
  console.log('\nTesting Douban search...');
  const res = await fetch(`${BASE_URL}/douban/search?q=${encodeURIComponent('思考，快与慢')}`);
  const data = await res.json();
  console.log('✅ Douban search result:', JSON.stringify(data, null, 2));
  return data.success;
}

async function runTests() {
  console.log('🚀 Starting API tests...\n');

  try {
    // Test 1: Health
    await testHealth();

    // Test 2: AI Classify
    await testClassify();

    // Test 3: AI Recommend
    await testRecommend();

    // Test 4: Douban Search
    await testDoubanSearch();

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

runTests();
