/**
 * 测试不同的认证格式
 */

const https = require('https');

const tests = [
  { key: '123456', desc: 'Plain key' },
  { key: 'sk-123456', desc: 'sk- prefix' },
];

async function testAuth(key, desc) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      model: 'deepseek-v4-flash-plus',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5
    });

    const req = https.request({
      hostname: 'litellm.203065.xyz',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`${desc}: HTTP ${res.statusCode}`);
        if (body.includes('error') || res.statusCode !== 200) {
          console.log('  Response:', body.slice(0, 200));
        } else {
          console.log('  ✓ Success!');
        }
        resolve();
      });
    });
    req.on('error', (e) => { console.log(`${desc}: Error - ${e.message}`); resolve(); });
    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('Testing LiteLLM auth formats...\n');
  for (const t of tests) {
    await testAuth(t.key, t.desc);
    console.log('');
  }
})();
