/**
 * 手工测试 LiteLLM 代理
 */

const https = require('https');

const data = JSON.stringify({
  model: 'deepseek-v4-flash-plus',
  messages: [{ role: 'user', content: 'Hello, are you working?' }],
  max_tokens: 50
});

const options = {
  hostname: 'litellm.203065.xyz',
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sk-123456',
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('Testing LiteLLM proxy...');
console.log('URL:', `https://${options.hostname}${options.path}`);
console.log('Model: deepseek-v4-flash-plus');
console.log('');

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  console.log('');

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('Response body:');
    try {
      const json = JSON.parse(body);
      console.log(JSON.stringify(json, null, 2));

      if (json.choices && json.choices[0]) {
        console.log('\n✓ LiteLLM proxy is working!');
        console.log('Response:', json.choices[0].message.content);
      } else if (json.error) {
        console.log('\n✗ LiteLLM returned error:', json.error.message);
      }
    } catch (e) {
      console.log(body);
    }
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(data);
req.end();
