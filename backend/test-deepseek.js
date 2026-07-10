/**
 * 测试 DeepSeek API
 */

const https = require('https');

const API_KEY = 'sk-a4e54f01705a4f1e8c91bb84f9e580b5';

const data = JSON.stringify({
  model: 'deepseek-chat',
  messages: [{ role: 'user', content: 'Hello, are you working?' }],
  max_tokens: 50
});

const options = {
  hostname: 'api.deepseek.com',
  path: '/chat/completions',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('Testing DeepSeek API...');
console.log('');

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('');

  let body = '';
  res.on('data', (chunk) => { body += chunk; });

  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      if (json.choices && json.choices[0]) {
        console.log('✓ DeepSeek API is working!');
        console.log('Response:', json.choices[0].message.content);
      } else if (json.error) {
        console.log('✗ DeepSeek API error:', json.error.message);
      } else {
        console.log('Response:', JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.log('Raw response:', body);
    }
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(data);
req.end();
