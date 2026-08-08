/**
 * AI 功能全面测试脚本
 * 测试所有 AI 端点：推荐流、书籍解读、阅读路径、书籍问答、阅读洞察、用户画像、书籍对比、读书总结
 */

const API_BASE = 'http://localhost:3001/api';

// 测试用的模拟书库数据
const mockLibrary = [
  {
    id: 'book-1',
    title: '深入理解计算机系统',
    author: 'Randal E. Bryant',
    category: '计算机科学',
    subcategory: '系统架构',
    level: 'Advanced',
    status: 'reading',
    rating: 5,
    userData: {
      totalPages: 733,
      currentPage: 200,
      progressPercentage: 27.3,
      startDate: '2024-01-01T00:00:00.000Z',
    },
    aiInsight: {
      summary: '从程序员的角度理解计算机系统的工作原理，涵盖数据表示、程序结构、存储器层次等。',
      advice: '建议在阅读时配合实验，加深对底层概念的理解。',
      keyChapters: ['第2章 信息的表示和处理', '第3章 机器级表示', '第6章 存储器层次结构'],
    },
    doubanData: {
      rating_score: 9.5,
      rating_count: 1234,
      summary: '从程序员的视角讲解计算机系统的工作原理。',
      tags: [{ name: '计算机科学', count: 500 }, { name: '系统架构', count: 300 }],
      publisher: '机械工业出版社',
      pubdate: '2016-11',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'book-2',
    title: '代码大全',
    author: 'Steve McConnell',
    category: '计算机科学',
    subcategory: '软件工程',
    level: 'Advanced',
    status: 'finished',
    rating: 5,
    userData: {
      totalPages: 936,
      currentPage: 936,
      progressPercentage: 100,
      startDate: '2023-06-01T00:00:00.000Z',
      completionDate: '2023-12-15T00:00:00.000Z',
    },
    aiInsight: {
      summary: '软件构建的百科全书，涵盖从设计到测试的完整流程。',
      advice: '适合有一定经验后回读，每次都能有新收获。',
      keyChapters: ['第7章 高质量的子程序', '第8章 防御式编程'],
    },
    doubanData: {
      rating_score: 9.3,
      rating_count: 2345,
      summary: '软件构建的实践指南。',
      tags: [{ name: '编程', count: 800 }, { name: '软件工程', count: 600 }],
      publisher: '电子工业出版社',
      pubdate: '2006-3',
    },
    createdAt: '2023-06-01T00:00:00.000Z',
    updatedAt: '2023-12-15T00:00:00.000Z',
  },
  {
    id: 'book-3',
    title: 'Python编程：从入门到实践',
    author: 'Eric Matthes',
    category: '计算机科学',
    subcategory: '编程语言',
    level: 'Basic',
    status: 'finished',
    rating: 4,
    userData: {
      totalPages: 564,
      currentPage: 564,
      progressPercentage: 100,
      startDate: '2023-01-01T00:00:00.000Z',
      completionDate: '2023-03-01T00:00:00.000Z',
    },
    aiInsight: {
      summary: 'Python入门经典，从基础语法到实战项目。',
      advice: '跟着项目动手实践效果最好。',
      keyChapters: ['第1章 起步', '第2章 变量和简单数据类型'],
    },
    createdAt: '2023-01-01T00:00:00.000Z',
    updatedAt: '2023-03-01T00:00:00.000Z',
  },
  {
    id: 'book-4',
    title: '算法导论',
    author: 'Thomas H. Cormen',
    category: '计算机科学',
    subcategory: '算法与数据结构',
    level: 'Expert',
    status: 'unread',
    createdAt: '2024-03-01T00:00:00.000Z',
    updatedAt: '2024-03-01T00:00:00.000Z',
  },
];

// SSE 流式请求辅助函数
async function fetchSSE(endpoint, body, onChunk, onPhase, onToolCall) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(`HTTP ${response.status}: ${error.error || JSON.stringify(error)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        try {
          const msg = JSON.parse(jsonStr);
          if (msg.type === 'chunk' && msg.content) {
            onChunk?.(msg.content);
          } else if (msg.type === 'phase' && onPhase) {
            onPhase(msg.phase);
          } else if (msg.type === 'tool_call' && onToolCall) {
            onToolCall(msg.tool, msg.label, msg.round);
          } else if (msg.type === 'done') {
            result = msg.data;
          } else if (msg.type === 'error') {
            throw new Error(msg.message || 'AI service error');
          }
        } catch (e) {
          if (e.message) throw e;
        }
      }
    }
  }

  return result;
}

// 测试辅助
function log(testName, message, data) {
  const prefix = data ? '✓' : '○';
  console.log(`[${prefix}] ${testName}: ${message}`);
  if (data) {
    console.log(`    数据预览: ${JSON.stringify(data).slice(0, 200)}...`);
  }
}

async function runTest(name, fn) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试: ${name}`);
  console.log('='.repeat(60));
  try {
    await fn();
    console.log(`✓ ${name} — 通过`);
  } catch (e) {
    console.error(`✗ ${name} — 失败: ${e.message}`);
    console.error(e.stack);
  }
}

// ============================================================================
// 测试用例
// ============================================================================

async function testRecommendStream() {
  let chunkCount = 0;
  let phaseCount = 0;
  let toolCallCount = 0;

  const result = await fetchSSE(
    '/ai/recommend/stream',
    {
      userRequest: '我想提升编程能力，有什么推荐？',
      library: mockLibrary,
    },
    (chunk) => { chunkCount++; },
    (phase) => { phaseCount++; console.log(`  阶段: ${phase}`); },
    (tool, label, round) => { toolCallCount++; console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`); },
  );

  if (!result || !result.analysis) throw new Error('返回数据缺少 analysis');
  if (!result.libraryMatches && !result.externalMatches) throw new Error('缺少推荐结果');
  log('推荐流式', `chunks=${chunkCount}, phases=${phaseCount}, toolCalls=${toolCallCount}`);
  log('推荐流式', '返回数据', { analysis: result.analysis, matchCount: (result.libraryMatches?.length || 0) + (result.externalMatches?.length || 0) });
}

async function testInsightStream() {
  let chunkCount = 0;

  const result = await fetchSSE(
    '/ai/insight/stream',
    {
      title: '设计模式',
      author: 'Erich Gamma',
      level: 'Advanced',
      category: '计算机科学',
      subcategory: '软件工程',
      library: mockLibrary,
    },
    (chunk) => { chunkCount++; },
    (phase) => console.log(`  阶段: ${phase}`),
    (tool, label, round) => console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`),
  );

  if (!result || !result.summary) throw new Error('返回数据缺少 summary');
  log('书籍解读', `chunks=${chunkCount}`, { summary: result.summary?.slice(0, 80), hasAdvice: !!result.advice });
}

async function testBookQAStream() {
  let chunkCount = 0;

  const result = await fetchSSE(
    '/ai/book-qa/stream',
    {
      question: '这本书和书库里其他书有什么关联？',
      bookContext: {
        title: '深入理解计算机系统',
        author: 'Randal E. Bryant',
        category: '计算机科学',
        level: 'Advanced',
        aiInsight: mockLibrary[0].aiInsight,
      },
      conversationHistory: [],
      library: mockLibrary,
    },
    (chunk) => { chunkCount++; },
  );

  if (!result || result.length < 10) throw new Error('返回内容过短');
  log('书籍问答(Agent)', `chunks=${chunkCount}, 长度=${result.length}`, { preview: result.slice(0, 100) });
}

async function testReadingInsightsStream() {
  const result = await fetchSSE(
    '/ai/reading-insights/stream',
    {
      totalBooks: mockLibrary.length,
      readingCount: 1,
      finishedCount: 2,
      unreadCount: 1,
      totalPagesRead: 1500,
      avgRating: 4.7,
      categoryDistribution: [{ category: '计算机科学', count: 4 }],
      levelDistribution: { Basic: 1, Advanced: 2, Expert: 1 },
      readingBooks: [{ title: '深入理解计算机系统', author: 'Bryant', progress: 27, category: '计算机科学' }],
      finishedBooks: [
        { title: '代码大全', author: 'McConnell', category: '计算机科学' },
        { title: 'Python编程', author: 'Matthes', category: '计算机科学' },
      ],
      library: mockLibrary,
    },
    () => {},
    (phase) => console.log(`  阶段: ${phase}`),
    (tool, label, round) => console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`),
  );

  if (!result || !result.overallAnalysis) throw new Error('返回数据缺少 overallAnalysis');
  log('阅读洞察', '完成', { analysis: result.overallAnalysis?.slice(0, 80) });
}

async function testProfileStream() {
  const result = await fetchSSE(
    '/ai/profile/stream',
    {
      totalBooks: mockLibrary.length,
      readingCount: 1,
      finishedCount: 2,
      unreadCount: 1,
      totalPagesRead: 1500,
      categoryDistribution: [{ category: '计算机科学', count: 4 }],
      levelDistribution: { Basic: 1, Advanced: 2, Expert: 1 },
      readingBooks: [{ title: '深入理解计算机系统', author: 'Bryant', progress: 27, category: '计算机科学', level: 'Advanced' }],
      finishedBooks: [
        { title: '代码大全', author: 'McConnell', category: '计算机科学', level: 'Advanced' },
        { title: 'Python编程', author: 'Matthes', category: '计算机科学', level: 'Basic' },
      ],
      library: mockLibrary,
    },
    () => {},
    (phase) => console.log(`  阶段: ${phase}`),
    (tool, label, round) => console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`),
  );

  if (!result || !result.inferredLevel) throw new Error('返回数据缺少 inferredLevel');
  log('用户画像', '完成', { level: result.inferredLevel, pattern: result.readingPattern?.slice(0, 80) });
}

async function testCompareBooksStream() {
  const result = await fetchSSE(
    '/ai/compare-books/stream',
    {
      books: [
        {
          title: '深入理解计算机系统',
          author: 'Randal E. Bryant',
          level: 'Advanced',
          category: '计算机科学',
          aiInsight: mockLibrary[0].aiInsight,
          doubanData: { rating_score: 9.5, rating_count: 1234 },
        },
        {
          title: '代码大全',
          author: 'Steve McConnell',
          level: 'Advanced',
          category: '计算机科学',
          aiInsight: mockLibrary[1].aiInsight,
          doubanData: { rating_score: 9.3, rating_count: 2345 },
        },
      ],
      library: mockLibrary,
    },
    () => {},
    (phase) => console.log(`  阶段: ${phase}`),
    (tool, label, round) => console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`),
  );

  if (!result || !result.overallVerdict) throw new Error('返回数据缺少 overallVerdict');
  log('书籍对比', '完成', {
    verdict: result.overallVerdict?.slice(0, 80),
    comparisons: result.comparisons?.length,
    hasRecommendation: !!result.recommendation,
  });
}

async function testReadingSummaryStream() {
  const result = await fetchSSE(
    '/ai/reading-summary/stream',
    {
      title: '代码大全',
      author: 'Steve McConnell',
      category: '计算机科学',
      subcategory: '软件工程',
      level: 'Advanced',
      totalPages: 936,
      rating: 5,
      aiInsight: mockLibrary[1].aiInsight,
      doubanData: {
        rating_score: 9.3,
        summary: '软件构建的实践指南。',
      },
      readingProgress: {
        startDate: '2023-06-01T00:00:00.000Z',
        completionDate: '2023-12-15T00:00:00.000Z',
        totalPages: 936,
      },
      library: mockLibrary,
    },
    () => {},
    (phase) => console.log(`  阶段: ${phase}`),
    (tool, label, round) => console.log(`  工具调用: ${tool} (${label}) [第${round}轮]`),
  );

  if (!result || !result.coreValue) throw new Error('返回数据缺少 coreValue');
  if (!result.oneLineSummary) throw new Error('返回数据缺少 oneLineSummary');
  log('读书总结', '完成', {
    coreValue: result.coreValue?.slice(0, 60),
    takeaways: result.keyTakeaways?.length,
    questions: result.reflectionQuestions?.length,
    actions: result.actionItems?.length,
    oneLine: result.oneLineSummary?.slice(0, 60),
  });
}

// ============================================================================
// 运行所有测试
// ============================================================================

async function main() {
  console.log('\n🚀 开始 AI 功能全面测试\n');

  await runTest('流式个性化推荐 (Agent)', testRecommendStream);
  await runTest('流式书籍解读 (Agent)', testInsightStream);
  await runTest('书籍问答 — Agent 模式', testBookQAStream);
  await runTest('阅读洞察 (Agent)', testReadingInsightsStream);
  await runTest('用户画像分析 (Agent)', testProfileStream);
  await runTest('书籍对比 (新功能)', testCompareBooksStream);
  await runTest('读书总结 (新功能)', testReadingSummaryStream);

  console.log('\n✅ 全部测试完成\n');
}

main().catch(console.error);
