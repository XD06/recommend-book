# API 状态报告

生成时间：2026-07-09

## 1. LiteLLM 代理 (https://litellm.203065.xyz)

**状态**: ❌ 不可用

**错误**: HTTP 502 (Bad Gateway)

**测试命令**:
```bash
node test-litellm.js
```

**结论**: LiteLLM 代理服务本身有问题，可能是后端 DeepSeek 服务连接失败。

---

## 2. DeepSeek API (https://api.deepseek.com)

**状态**: ❌ 不可用

**错误**: HTTP 402 (Insufficient Balance)

**测试命令**:
```bash
node test-deepseek.js
```

**结论**: API Key 余额不足，需要充值或更换新的 API Key。

---

## 3. 豆瓣代理 (https://douban-proxy.203065.xyz)

**状态**: ✅ 可用

**测试结果**:
- 搜索功能正常
- 可以获取书籍列表和封面 URL

---

## 当前配置

当前 `.env` 配置使用 DeepSeek API（等待充值恢复）。

当 LiteLLM 服务恢复后，可以切换到 LiteLLM 配置：

```env
LITELLM_API_KEY=sk-123456
LITELLM_BASE_URL=https://litellm.203065.xyz/v1
LITELLM_MODEL=deepseek-v4-flash-plus
```

---

## 测试脚本

| 脚本 | 用途 |
|------|------|
| `test-litellm.js` | 测试 LiteLLM 代理 |
| `test-deepseek.js` | 测试 DeepSeek API |
| `test-full-api.js` | 全量 API 测试（需要 AI 服务可用） |
