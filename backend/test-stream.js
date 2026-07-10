/**
 * 测试 LiteLLM 流式请求
 */

const https = require('https');

const data = JSON.stringify({
  model: 'deepseek-v4-flash-plus',
  messages: [{ role: 'user', content: 'Hello' }],
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
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  console.log('');

  let buffer = '';
  res.on('data', (chunk) => {
    buffer += chunk;
    // 尝试解析 SSE 数据
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') {
          console.log('Stream complete');
          return;
        }
        try {
          const json = JSON.parse(jsonStr);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            process.stdout.write(content);
          }
        } catch (e) {
          // Ignore parse errors for incomplete chunks
        }
      }
    }
  });

  res.on('end', () => {
    console.log('\n\nResponse ended');
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(data);
req.end();
