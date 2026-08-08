/**
 * Agent SSE 端到端测试 — 测试 Exa Web 搜索工具在 Agent 流程中的表现
 * 
 * 测试场景：
 * 1. 推荐流 — 请求推荐一本书库中不存在的新书（触发 web_search）
 * 2. Book QA 流 — 问一个需要实时信息的问题
 * 
 * 使用方式：
 *   先启动后端: npx tsx src/index.ts
 *   再运行此脚本: npx tsx test-e2e-exa.js
 */

const BASE_URL = 'http://localhost:3001/api/ai';

// 模拟一个最小的书库
const mockLibrary = [
  {
    id: 'b1',
    title: '深入理解计算机系统',
    author: 'Randal E. Bryant',
    category: '计算机科学',
    subcategory: '系统编程',
    level: 'Advanced',
    status: 'finished',
    rating: 5,
    doubanData: { rating_score: 9.5, tags: [{ name: '计算机' }, { name: '经典' }] },
    aiInsight: { summary: '从程序员角度理解计算机系统的工作原理', advice: '适合有编程基础后深入阅读', keyChapters: [] },
  },
  {
    id: 'b2',
    title: '代码大全',
    author: 'Steve McConnell',
    category: '计算机科学',
    subcategory: '软件工程',
    level: 'Advanced',
    status: 'reading',
    doubanData: { rating_score: 9.3 },
  },
];

const mockUserProfile = {
  nickname: '测试用户',
  readingLevel: 'advanced',
  readingGoal: '系统提升技术能力',
  preferredCategories: ['计算机科学'],
  dailyReadingTime: 60,
};

// SSE 事件解析器
async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(data);
        } catch {
          // 非 JSON 行（如 heartbeat ping），跳过
        }
      }
    }
  }
}

// ============================================================
// 测试 1: /recommend/stream — 请求推荐新书（触发 web_search）
// ============================================================
async function testRecommendStream() {
  console.log('='.repeat(60));
  console.log('测试 1: /recommend/stream — 触发 web_search 的推荐');
  console.log('='.repeat(60));

  const body = {
    userRequest: '帮我推荐一本 2024 年出版的关于大语言模型和 LLM 应用开发的新书，我书库里好像没有这方面的',
    userProfile: mockUserProfile,
    library: mockLibrary,
    conversationHistory: [],
  };

  try {
    const response = await fetch(`${BASE_URL}/recommend/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${await response.text()}`);
      return;
    }

    let fullContent = '';
    let toolCalls = [];
    let eventCount = 0;
    let doneData = null;

    await readSSE(response, (data) => {
      eventCount++;

      if (data.type === 'phase') {
        console.log(`  [Phase] ${data.phase}`);
      } else if (data.type === 'tool_call') {
        console.log(`  [Tool Call] Round ${data.round}: ${data.tool || data.toolName} — ${data.label}`);
        toolCalls.push(data);
      } else if (data.type === 'content' || data.type === 'chunk') {
        fullContent += data.content || '';
      } else if (data.type === 'done') {
        console.log(`  [Done]`);
        doneData = data.data || data;
      } else if (data.type === 'error') {
        console.error(`  [Error] ${data.message || JSON.stringify(data)}`);
      }
    });

    console.log('\n--- 汇总 ---');
    console.log(`总事件数: ${eventCount}`);
    console.log(`工具调用次数: ${toolCalls.length}`);
    const webToolCalls = toolCalls.filter(t => t.tool === 'web_search' || t.tool === 'web_fetch' || t.toolName === 'web_search' || t.toolName === 'web_fetch');
    if (webToolCalls.length > 0) {
      console.log(`Web 工具调用: ${webToolCalls.length}`);
      console.log('  ✅ Agent 成功调用了 Web 搜索工具！');
      for (const tc of webToolCalls) {
        const name = tc.tool || tc.toolName;
        console.log(`    - ${name}: ${tc.label}`);
      }
    } else {
      console.log('  ⚠️ Agent 未调用 Web 工具（可能书库已有足够信息）');
      if (toolCalls.length > 0) {
        console.log('  调用的工具:');
        for (const tc of toolCalls) {
          console.log(`    - ${tc.tool || tc.toolName}: ${tc.label}`);
        }
      }
    }
    console.log(`\n生成内容长度: ${fullContent.length} 字符`);
    if (fullContent) {
      console.log(`内容预览: ${fullContent.slice(0, 300)}...`);
    }
    if (doneData) {
      const jsonStr = JSON.stringify(doneData);
      console.log(`\nDone 事件数据长度: ${jsonStr.length} 字符`);
      console.log(`Done 数据预览: ${jsonStr.slice(0, 500)}...`);
    }

  } catch (err) {
    console.error('❌ 请求失败:', err.message);
  }
  console.log('');
}

// ============================================================
// 测试 2: /book-qa/stream — 书籍问答（触发 web_search）
// ============================================================
async function testBookQAStream() {
  console.log('='.repeat(60));
  console.log('测试 2: /book-qa/stream — 书籍问答（需实时信息）');
  console.log('='.repeat(60));

  const body = {
    question: '最近有什么新出版的 Rust 书籍推荐？我想了解 2024 年的最新评价和推荐',
    bookContext: {
      title: '深入理解计算机系统',
      author: 'Randal E. Bryant',
      category: '计算机科学',
      level: 'Advanced',
    },
    library: mockLibrary,
    conversationHistory: [],
  };

  try {
    const response = await fetch(`${BASE_URL}/book-qa/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${await response.text()}`);
      return;
    }

    let fullContent = '';
    let toolCalls = [];
    let eventCount = 0;

    await readSSE(response, (data) => {
      eventCount++;

      if (data.type === 'phase') {
        console.log(`  [Phase] ${data.phase}`);
      } else if (data.type === 'tool_call') {
        console.log(`  [Tool Call] Round ${data.round}: ${data.tool || data.toolName} — ${data.label}`);
        toolCalls.push(data);
      } else if (data.type === 'content' || data.type === 'chunk') {
        fullContent += data.content || '';
      } else if (data.type === 'done') {
        console.log(`  [Done]`);
      } else if (data.type === 'error') {
        console.error(`  [Error] ${data.message || JSON.stringify(data)}`);
      }
    });

    console.log('\n--- 汇总 ---');
    console.log(`总事件数: ${eventCount}`);
    console.log(`工具调用次数: ${toolCalls.length}`);
    const webToolCalls = toolCalls.filter(t => t.tool === 'web_search' || t.tool === 'web_fetch' || t.toolName === 'web_search' || t.toolName === 'web_fetch');
    if (webToolCalls.length > 0) {
      console.log(`Web 工具调用: ${webToolCalls.length}`);
      console.log('  ✅ Book QA 成功调用了 Web 搜索工具！');
      for (const tc of webToolCalls) {
        const name = tc.tool || tc.toolName;
        console.log(`    - ${name}: ${tc.label}`);
      }
    } else {
      console.log('  ⚠️ Book QA 未调用 Web 工具');
      if (toolCalls.length > 0) {
        console.log('  调用的工具:');
        for (const tc of toolCalls) {
          console.log(`    - ${tc.tool || tc.toolName}: ${tc.label}`);
        }
      }
    }
    console.log(`\n生成内容长度: ${fullContent.length} 字符`);
    console.log(`内容预览: ${fullContent.slice(0, 500)}...`);

  } catch (err) {
    console.error('❌ 请求失败:', err.message);
  }
  console.log('');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log('Exa API 端到端集成测试');
  console.log(`目标: ${BASE_URL}`);
  console.log('');

  // 检查后端是否运行（发一个 OPTIONS 请求）
  try {
    const resp = await fetch('http://localhost:3001/', { method: 'GET' });
    console.log('✅ 后端服务器运行中\n');
  } catch {
    console.error('❌ 后端服务器未运行，请先启动: npx tsx src/index.ts');
    process.exit(1);
  }

  await testRecommendStream();
  await testBookQAStream();

  console.log('='.repeat(60));
  console.log('端到端测试完成');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});
