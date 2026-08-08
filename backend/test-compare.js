const API = 'http://localhost:3001/api';
const lib = [
  {id:'b1',title:'深入理解计算机系统',author:'Bryant',category:'计算机科学',subcategory:'系统架构',level:'Advanced',status:'reading',aiInsight:{summary:'从程序员角度理解计算机系统工作原理。',advice:'配合实验阅读。',keyChapters:['第2章']},doubanData:{rating_score:9.5,rating_count:1234,summary:'经典CS教材。'},createdAt:'2024-01-01',updatedAt:'2024-01-01'},
  {id:'b2',title:'代码大全',author:'McConnell',category:'计算机科学',subcategory:'软件工程',level:'Advanced',status:'finished',aiInsight:{summary:'软件构建百科全书。',advice:'有经验后回读。',keyChapters:['第7章']},doubanData:{rating_score:9.3,rating_count:2345,summary:'软件构建实践指南。'},createdAt:'2023-06-01',updatedAt:'2023-12-15'},
];

async function test() {
  console.log('Testing /ai/compare-books/stream ...');
  const res = await fetch(API + '/ai/compare-books/stream', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      books: [
        {title:'深入理解计算机系统',author:'Bryant',level:'Advanced',category:'计算机科学',aiInsight:lib[0].aiInsight,doubanData:{rating_score:9.5,rating_count:1234}},
        {title:'代码大全',author:'McConnell',level:'Advanced',category:'计算机科学',aiInsight:lib[1].aiInsight,doubanData:{rating_score:9.3,rating_count:2345}},
      ],
      library: lib,
    }),
  });
  if (!res.ok) { console.log('FAIL HTTP', res.status, await res.text()); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result = null, chunks = 0, tools = [];
  while(true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += dec.decode(value, {stream:true});
    const lines = buf.split('\n'); buf = lines.pop()||'';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.type==='chunk') chunks++;
          else if (msg.type==='phase') console.log('  Phase:', msg.phase);
          else if (msg.type==='tool_call') { tools.push(msg.tool); console.log('  Tool:', msg.tool, '-', msg.label, '[R'+msg.round+']'); }
          else if (msg.type==='done') result = msg.data;
          else if (msg.type==='error') { console.log('  ERROR:', msg.message); }
        } catch(e) { if(e.message) { console.log('  Parse err:', e.message); } }
      }
    }
  }
  console.log('Chunks:', chunks, 'Tools:', tools.length);
  console.log('Verdict:', result?.overallVerdict?.slice(0,120));
  console.log('Comparisons:', result?.comparisons?.length);
  console.log('Has recommendation:', !!result?.recommendation);
  console.log('ReadingOrder:', result?.readingOrder?.slice(0,80));
  console.log('DONE');
}
test().catch(e => console.error('ERROR:', e.message));
