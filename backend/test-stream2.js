/**
 * 测试 LiteLLM 流式请求 - 显示原始数据
 */

const https = require('https');

const data = JSON.stringify({
  model: 'deepseek-v4-flash-plus',
  messages: [{ role: 'user', content: 'Hello, say something' }],
  max_tokens: 50,
  stream: true
});

const options = {
  hostname: 'litellm.203065.xyz',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk-123456',
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log('Testing LiteLLM with streaming...\n');

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('');

  let fullResponse = '';

  res.on('data', (chunk) => {
    const text = chunk.toString();
    fullResponse += text;
    process.stdout.write(text);
  });

  res.on('end', () => {
    console.log('\n\n--- Full response ---');
    console.log(fullResponse);
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(data);
req.end();
