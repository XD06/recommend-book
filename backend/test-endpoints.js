const API = 'http://localhost:3001/api';

async function testAll() {
  const endpoints = [
    { path: '/ai/recommend', method: 'POST', body: {userRequest:'test', library:[]}, name:'推荐(非流式)' },
    { path: '/ai/recommend/stream', method: 'POST', body: {userRequest:'test', library:[]}, name:'推荐(流式)', stream:true },
    { path: '/ai/compare-books/stream', method: 'POST', body: {books:[], library:[]}, name:'对比(流式)', stream:true },
    { path: '/ai/reading-summary/stream', method: 'POST', body:{title:'test',author:'test',library:[]}, name:'读书总结(流式)', stream:true },
    { path: '/ai/book-qa/stream', method: 'POST', body:{question:'test',bookContext:{title:'test',author:'test'},conversationHistory:[],library:[]}, name:'问答(流式)', stream:true },
  ];

  for (const ep of endpoints) {
    try {
      console.log(`Testing ${ep.name}...`);
      const res = await fetch(API + ep.path, {
        method: ep.method, headers: {'Content-Type':'application/json'},
        body: JSON.stringify(ep.body),
      });
      console.log(`  Status: ${res.status}`);
      if (!res.ok) {
        const text = await res.text();
        console.log(`  Error: ${text}`);
      } else if (ep.stream) {
        // 简单读取一些内容来验证流式是否工作
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let chunkCount = 0, gotChunk = false, gotDone = false, gotPhase = false;
      const timeout = setTimeout(() => console.log('  ⚠ Timeout (10s)'), 10000);
      let buf = '';
      try {
          while (chunkCount < 5) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += dec.decode(value, {stream:true});
            const lines = buf.split('\n'); buf = lines.pop()||'';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const msg = JSON.parse(line.slice(6));
                  if (msg.type === 'chunk') { gotChunk = true; chunkCount++; }
                  else if (msg.type === 'phase') { gotPhase = true; }
                  else if (msg.type === 'done') { gotDone = true; break; }
                } catch (e) { }
              }
            }
          }
        } finally { clearTimeout(timeout); }
        console.log(`  Stream check: ${gotChunk ? 'Got chunk ✓' : 'No chunk ✗'}, ${gotDone ? 'Done ✓' : 'No done ✗'}, ${gotPhase ? 'Got phase ✓' : 'No phase ✗'}`);
      } else {
        const text = await res.text();
        console.log(`  Body length: ${text.length}`);
      }
      console.log(`  ${ep.name} - ✓`);
    } catch (e) {
      console.log(`  ${ep.name} - ✗ ${e.message}`);
    }
  }
  console.log('\n=== All endpoints tested ===');
}
testAll().catch(e => console.error('FATAL:', e));