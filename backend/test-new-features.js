/**
 * 新功能快速测试 — 只测试书籍对比和读书总结
 */
const API_BASE = 'http://localhost:3001/api';

const mockLibrary = [
  {
    id: 'book-1', title: '深入理解计算机系统', author: 'Randal E. Bryant',
    category: '计算机科学', subcategory: '系统架构', level: 'Advanced', status: 'reading',
    rating: 5, userData: { totalPages: 733, currentPage: 200, progressPercentage: 27.3 },
    aiInsight: { summary: '从程序员角度理解计算机系统工作原理。', advice: '配合实验阅读。', keyChapters: ['第2章'] },
    doubanData: { rating_score: 9.5, rating_count: 1234, summary: '经典CS教材。' },
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'book-2', title: '代码大全', author: 'Steve McConnell',
    category: '计算机科学', subcategory: '软件工程', level: 'Advanced', status: 'finished',
    rating: 5, userData: { totalPages: 936, currentPage: 936, progressPercentage: 100, completionDate: '2023-12-15T00:00:00.000Z' },
    aiInsight: { summary: '软件构建百科全书。', advice: '有经验后回读。', keyChapters: ['第7章'] },
    doubanData: { rating_score: 9.3, rating_count: 2345, summary: '软件构建实践指南。' },
    createdAt: '2023-06-01T00:00:00.000Z', updatedAt: '2023-12-15T00:00:00.000Z',
  },
];

async function fetchSSE(endpoint, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null, chunkCount = 0, toolCalls = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.type === 'chunk') chunkCount++;
          else if (msg.type === 'phase') console.log(`  Phase: ${msg.phase}`);
          else if (msg.type === 'tool_call') { toolCalls.push(`${msg.tool}(${msg.label})`); console.log(`  Tool: ${msg.tool} - ${msg.label} [R${msg.round}]`); }
          else if (msg.type === 'done') result = msg.data;
          else if (msg.type === 'error') throw new Error(msg.message);
        } catch (e) { if (e.message) throw e; }
      }
    }
  }
  return { result, chunkCount, toolCalls };
}

async function main() {
  console.log('=== Test 1: Book Comparison ===');
  try {
    const { result, chunkCount, toolCalls } = await fetchSSE('/ai/compare-books/stream', {
      books: [
        { title: '深入理解计算机系统', author: 'Bryant', level: 'Advanced', category: '计算机科学',
          aiInsight: mockLibrary[0].aiInsight, doubanData: { rating_score: 9.5 } },
        { title: '代码大全', author: 'McConnell', level: 'Advanced', category: '计算机科学',
          aiInsight: mockLibrary[1].aiInsight, doubanData: { rating_score: 9.3 } },
      ],
      library: mockLibrary,
    });
    console.log(`  Chunks: ${chunkCount}, Tools: ${toolCalls.length}`);
    console.log(`  Verdict: ${result?.overallVerdict?.slice(0, 100)}`);
    console.log(`  Comparisons: ${result?.comparisons?.length}`);
    console.log(`  Recommendation: ${JSON.stringify(result?.recommendation)?.slice(0, 200)}`);
    console.log('  PASS');
  } catch (e) { console.error(`  FAIL: ${e.message}`); }

  console.log('\n=== Test 2: Reading Summary ===');
  try {
    const { result, chunkCount, toolCalls } = await fetchSSE('/ai/reading-summary/stream', {
      title: '代码大全', author: 'Steve McConnell',
      category: '计算机科学', subcategory: '软件工程', level: 'Advanced',
      totalPages: 936, rating: 5,
      aiInsight: mockLibrary[1].aiInsight,
      doubanData: { rating_score: 9.3, summary: '软件构建实践指南。' },
      readingProgress: { startDate: '2023-06-01', completionDate: '2023-12-15', totalPages: 936 },
      library: mockLibrary,
    });
    console.log(`  Chunks: ${chunkCount}, Tools: ${toolCalls.length}`);
    console.log(`  CoreValue: ${result?.coreValue?.slice(0, 100)}`);
    console.log(`  KeyTakeaways: ${result?.keyTakeaways?.length}`);
    console.log(`  ReflectionQuestions: ${result?.reflectionQuestions?.length}`);
    console.log(`  ActionItems: ${result?.actionItems?.length}`);
    console.log(`  OneLineSummary: ${result?.oneLineSummary?.slice(0, 100)}`);
    console.log('  PASS');
  } catch (e) { console.error(`  FAIL: ${e.message}`); }

  console.log('\n=== Test 3: Book QA (Agent mode) ===');
  try {
    const { result, chunkCount } = await fetchSSE('/ai/book-qa/stream', {
      question: '我书库里还有什么相关书籍？',
      bookContext: {
        title: '深入理解计算机系统', author: 'Bryant',
        category: '计算机科学', level: 'Advanced',
        aiInsight: mockLibrary[0].aiInsight,
      },
      conversationHistory: [],
      library: mockLibrary,
    });
    console.log(`  Chunks: ${chunkCount}`);
    console.log(`  Answer length: ${result?.length}`);
    console.log(`  Preview: ${result?.slice(0, 150)}`);
    console.log('  PASS');
  } catch (e) { console.error(`  FAIL: ${e.message}`); }

  console.log('\n=== All tests done ===');
}

main().catch(console.error);
