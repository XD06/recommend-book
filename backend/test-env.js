/**
 * 检查环境变量
 */

require('dotenv').config();

console.log('Environment Variables:');
console.log('LITELLM_BASE_URL:', process.env.LITELLM_BASE_URL);
console.log('LITELLM_API_KEY:', process.env.LITELLM_API_KEY ? '***' + process.env.LITELLM_API_KEY.slice(-4) : 'NOT SET');
console.log('LITELLM_MODEL:', process.env.LITELLM_MODEL);
console.log('');
console.log('isLiteLLM:', !!process.env.LITELLM_BASE_URL);
