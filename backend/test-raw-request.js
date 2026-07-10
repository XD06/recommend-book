/**
 * 使用原始 HTTP 请求测试 LiteLLM
 * 对比 OpenAI SDK 和原始请求的差异
 */

const https = require('https');

// 测试不同的请求格式
const tests = [
  {
    name: '标准 OpenAI 格式',
    body: {
      model: 'deepseek-v4-flash-plus',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10,
      temperature: 0.7
    }
  },
  {
    name: '带 stream: false',
    body: {
      model: 'deepseek-v4-flash-plus',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10,
      stream: false
    }
  },
  {
    name: '最简格式',
    body: {
      model: 'deepseek-v4-flash-plus',
      messages: [{ role: 'user', content: 'Hello' }]
    }
  }
];

function testRequest(name, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);

    const options = {
      hostname: 'litellm.203065.xyz',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk-123456',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    console.log(`\n--- ${name} ---`);
    console.log('Request body:', JSON.stringify(body, null, 2));
    console.log('Content-Length:', Buffer.byteLength(data));

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Response:', responseData.slice(0, 500));
        resolve();
      });
    });

    req.on('error', (e) => {
      console.log(`Error: ${e.message}`);
      resolve();
    });

    req.write(data);
    req.end();
  });
}

(async () => {
  console.log('Testing LiteLLM with different request formats...\n');
  for (const test of tests) {
    await testRequest(test.name, test.body);
  }
})();
