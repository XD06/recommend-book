const API = 'http://localhost:3001/api';
const lib = [
  {id:'b1',title:'深入理解计算机系统',author:'Bryant',category:'计算机科学',status:'reading',aiInsight:{summary:'经典CS教材。'},createdAt:'2024-01-01',updatedAt:'2024-01-01'},
];

async function test() {
  console.log('Testing /ai/recommend/stream...');
  const res = await fetch(API + '/ai/recommend/stream', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({userRequest:'推荐书', library:lib}),
  });
  console.log('Status:', res.status);
  if (!res.ok) { console.log('Error body:', await res.text()); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', result = null, chunks = 0;
  while (true) {
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
          else if (msg.type==='done') result = msg.data;
          else if (msg.type==='error') console.log('  ERROR:', msg.message);
        } catch(e) { if (e.message) console.log('  Parse err:', e.message); }
      }
    }
  }
  console.log('Chunks:', chunks);
  console.log('Result analysis:', result?.analysis?.slice(0,80));
  console.log('DONE');
}
test().catch(e => console.error('ERROR:', e.message));