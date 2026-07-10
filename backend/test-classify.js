/**
 * 直接测试分类 API
 */

const http = require('http');

const data = JSON.stringify({
  titles: ['三体', '代码大全'],
  existingCategories: ['科幻', '技术']
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/ai/classify',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log('Testing classify API...\n');

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(data);
req.end();
