/**
 * AI 服务层
 * 
 * 封装 LiteLLM / DeepSeek API 调用，提供：
 * 1. 书籍分类
 * 2. 阅读顾问（非流式 + 流式 Agent）
 * 3. 书籍解读（非流式 + 流式 Agent）
 * 4. 阅读路径规划（非流式 + 流式 Agent）
 * 5. 书籍问答（流式 Agent）
 * 6. 阅读洞察（流式 Agent）
 * 7. 用户画像分析（流式 Agent）
 * 8. 书籍对比（流式 Agent）
 * 9. 读书总结（流式 Agent）
 */

import OpenAI from 'openai';
import { 
  Book, 
  BookLevel, 
  AIInsight, 
  AIResponse, 
  AIRequestContext,
  ReadingPathResponse,
  UserProfile,
} from '../types';
import {
  BOOK_CLASSIFIER_SYSTEM_PROMPT,
  buildBookClassifierUserPrompt,
  READING_ADVISOR_SYSTEM_PROMPT,
  buildReadingAdvisorUserPrompt,
  buildCategoryFocusedPrompt,
  INSIGHT_GENERATOR_SYSTEM_PROMPT,
  buildInsightGeneratorUserPrompt,
  BOOK_COMPARISON_SYSTEM_PROMPT,
  buildBookComparisonUserPrompt,
  buildBookQAContext,
  BOOK_QA_SYSTEM_PROMPT,
  READING_SUMMARY_SYSTEM_PROMPT,
  buildReadingSummaryUserPrompt,
  READING_INSIGHTS_SYSTEM_PROMPT,
  NOTE_ORGANIZER_SYSTEM_PROMPT,
  buildNoteOrganizerUserPrompt,
  READING_PATH_SYSTEM_PROMPT,
  PROFILE_ANALYSIS_SYSTEM_PROMPT,
  withTools,
} from '../prompts';
import {
  getAllTools,
  executeAllTools,
  buildLibraryOverview,
  clearToolCache,
  describeToolCallUnified,
  BookUpdateCallback,
} from './libraryTools';

// 获取当前使用的模型
const getModel = () => process.env.LITELLM_MODEL || 'deepseek-chat';

// 获取 fallback 模型（主模型不可用时降级）
const getFallbackModel = (): string | undefined =>
  process.env.LITELLM_FALLBACK_MODEL || process.env.DEEPSEEK_FALLBACK_MODEL || undefined;

// 判断是否使用 LiteLLM（运行时判断，确保 dotenv 已加载）
const isLiteLLM = () => !!process.env.LITELLM_BASE_URL;

// AI 调用超时（毫秒）
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '30000', 10);

// 重试配置
const AI_MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES || '2', 10);
const AI_RETRY_BASE_DELAY = parseInt(process.env.AI_RETRY_BASE_DELAY || '1000', 10);

// 上下文窗口管理配置
const MAX_CONVERSATION_TOKENS = parseInt(process.env.MAX_CONVERSATION_TOKENS || '12000', 10);
const MAX_CONVERSATION_MESSAGES = parseInt(process.env.MAX_CONVERSATION_MESSAGES || '20', 10);

// 初始化 OpenAI 客户端（仅用于 DeepSeek）
const openai = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  timeout: AI_TIMEOUT_MS,
});

/**
 * 创建 AbortSignal，支持超时和外部取消
 */
function createAbortSignal(externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

/**
 * 创建空闲超时 AbortSignal — 每次收到数据就重置计时器
 * 推理模型（如 deepseek-v4-flash-plus）会先输出 reasoning_content 再输出 content，
 * 固定超时会在推理阶段就杀掉请求。空闲超时只在真正无数据时才触发。
 */
function createIdleAbortSignal(externalSignal?: AbortSignal): { signal: AbortSignal; reset: () => void; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return {
    signal: controller.signal,
    reset: resetTimer,
    cleanup: () => clearTimeout(timer),
  };
}

// ============================================================================
// LiteLLM 流式 HTTP 调用（支持 tool_calls 收集）
// ============================================================================

async function callLiteLLM(body: any, externalSignal?: AbortSignal, onReasoning?: (chunk: string) => void): Promise<any> {
  const url = process.env.LITELLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions';
  const apiKey = process.env.LITELLM_API_KEY!;

  const requestBody = {
    ...body,
    stream: true,
  };

  const model = body.model || 'unknown';
  const msgCount = body.messages?.length || 0;
  const bodyJson = JSON.stringify(requestBody);
  console.log(`[AI] → LiteLLM 调用: model=${model}, messages=${msgCount}, tools=${body.tools?.length || 0}, body=${(bodyJson.length / 1024).toFixed(1)}KB`);
  const fetchStart = Date.now();

  const { signal, reset: resetIdle, cleanup } = createIdleAbortSignal(externalSignal);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: bodyJson,
    signal,
  });
  console.log(`[AI] ← LiteLLM 响应: ${response.status} (${Date.now() - fetchStart}ms)`);

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`LiteLLM request failed: ${response.status} ${errorText.slice(0, 200)}`) as any;
    // 502/503/504 通常是网关错误，标记为不可重试（服务挂了，重试无用）
    if ([502, 503, 504].includes(response.status)) {
      err.status = response.status;
      err.name = 'GatewayError';
      console.error(`[AI] ⚠️ LiteLLM 网关错误 ${response.status} — 服务可能不可用，不重试`);
    }
    throw err;
  }

  // 收集流式响应
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let reasoningContent = '';
  let buffer = '';
  // 收集 tool_calls（按 index 累积）
  const toolCallsMap = new Map<number, any>();
  let finishReason = 'stop';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // 收到数据，重置空闲超时
      resetIdle();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
            }
            // 处理推理模型的 reasoning_content（如 deepseek-v4-flash-plus）
            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content;
              // 实时推送推理内容到前端，避免 Phase 1 阶段用户看不到任何进展
              onReasoning?.(delta.reasoning_content);
            }
            // 收集 tool_calls 增量
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  });
                }
                const existing = toolCallsMap.get(idx);
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              }
            }
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  } finally {
    cleanup();
  }

  const toolCalls = Array.from(toolCallsMap.values()).filter((tc: any) => tc.function.name);

  console.log(`[AI] LiteLLM 完成: content=${fullContent.length}字, reasoning=${reasoningContent.length}字, tool_calls=${toolCalls.length}个 (${Date.now() - fetchStart}ms)`);

  return {
    choices: [{
      message: {
        content: fullContent || null,
        role: 'assistant',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: finishReason,
    }],
  };
}

// ============================================================================
// 通用 AI 调用函数
// ============================================================================

interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callAI(
  messages: AIMessage[],
  temperature: number = 0.7,
  signal?: AbortSignal
): Promise<string | null> {
  if (isLiteLLM()) {
    const response = await callLiteLLM({
      model: getModel(),
      messages,
      temperature,
    }, signal);
    return response.choices[0]?.message?.content || null;
  } else {
    const { signal: innerSignal, cleanup } = createAbortSignal(signal);
    try {
      const completion = await openai.chat.completions.create({
        model: getModel(),
        messages,
        response_format: { type: 'json_object' },
        temperature,
      }, { signal: innerSignal });
      return completion.choices[0].message.content;
    } finally {
      cleanup();
    }
  }
}

/**
 * 流式 AI 调用 — 逐块推送文本
 */
async function callAIStream(
  messages: AIMessage[],
  onChunk: (chunk: string) => void,
  temperature: number = 0.7,
  signal?: AbortSignal
): Promise<string> {
  let fullContent = '';
  const { signal: innerSignal, reset: resetIdle, cleanup } = createIdleAbortSignal(signal);

  try {
    if (isLiteLLM()) {
      const url = process.env.LITELLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions';
      const apiKey = process.env.LITELLM_API_KEY!;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({ model: getModel(), messages, temperature, stream: true }),
        signal: innerSignal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LiteLLM stream failed: ${response.status} ${error}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdle();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              if (jsonStr === '[DONE]') continue;
              try {
                const chunk = JSON.parse(jsonStr);
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onChunk(content);
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') break;
          break;
        }
      }
    } else {
      // DeepSeek SDK 流式
      const stream = await openai.chat.completions.create({
        model: getModel(),
        messages,
        temperature,
        stream: true,
      }, { signal: innerSignal }) as any;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullContent += content;
          onChunk(content);
        }
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return fullContent;
    }
    throw e;
  } finally {
    cleanup();
  }

  return fullContent;
}

// ============================================================================
// 重试 + 模型降级
// ============================================================================

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** 判断错误是否可重试 */
function isRetryableError(err: any): boolean {
if (err?.name === 'AbortError') return false;
if (err?.name === 'GatewayError') return false; // 502/503/504 网关错误，服务挂了，不重试
const status = err?.status || err?.statusCode;
if (status && RETRYABLE_STATUS.has(status)) return true;
// 网络错误 / 超时
const msg = err?.message || '';
if (/timeout|network|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) return true;
// LiteLLM / DeepSeek HTTP 错误中包含状态码（排除 502/503/504 已标记为 GatewayError）
if (/failed: (429|500)/.test(msg)) return true;
return false;
}

/** 指数退避延迟 */
function getRetryDelay(attempt: number): number {
  const base = AI_RETRY_BASE_DELAY * Math.pow(2, attempt);
  // 添加 ±25% 随机抖动，避免惊群
  const jitter = base * (0.75 + Math.random() * 0.5);
  return Math.floor(jitter);
}

/**
 * 带重试的 AI 调用包装器
 *
 * - 最多重试 AI_MAX_RETRIES 次（默认 3 次）
 * - 指数退避 + 随机抖动
 * - 全部失败后，如果有 fallback 模型，降级尝试一次
 * - AbortError 不重试，直接抛出
 */
async function callWithRetry<T>(
fn: (model: string) => Promise<T>,
signal?: AbortSignal,
): Promise<T> {
const primaryModel = getModel();
let lastError: any;

for (let attempt = 0; attempt < AI_MAX_RETRIES; attempt++) {
if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
console.log(`[AI] 调用 AI (attempt ${attempt + 1}/${AI_MAX_RETRIES}, model=${primaryModel})`);
try {
return await fn(primaryModel);
} catch (err: any) {
lastError = err;
if (err?.name === 'AbortError') throw err;
if (!isRetryableError(err)) throw err;
if (attempt < AI_MAX_RETRIES - 1) {
const delay = getRetryDelay(attempt);
console.warn(`[AI] 调用失败 (attempt ${attempt + 1}/${AI_MAX_RETRIES}), ${delay}ms 后重试: ${err.message?.slice(0, 100)}`);
await new Promise(resolve => setTimeout(resolve, delay));
}
}
}

  // 全部重试失败 — 尝试 fallback 模型
  const fallbackModel = getFallbackModel();
  if (fallbackModel && fallbackModel !== primaryModel) {
    console.warn(`[AI] 主模型 ${primaryModel} 全部重试失败，降级到 ${fallbackModel}`);
    try {
      return await fn(fallbackModel);
    } catch (err: any) {
      console.error(`[AI] Fallback 模型 ${fallbackModel} 也失败: ${err.message?.slice(0, 100)}`);
      lastError = err;
    }
  }

  throw lastError;
}

// ============================================================================
// 上下文窗口管理 — 滑动窗口裁剪
// ============================================================================

/** 粗略估算消息的 token 数（中文字符 ≈ 1.5 token，英文 ≈ 0.75 token/word） */
function estimateTokens(text: string): number {
  if (!text) return 0;
  let chineseChars = 0;
  let otherChars = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) chineseChars++;
    else otherChars++;
  }
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.3);
}

/** 估算单条消息的 token 数 */
function estimateMessageTokens(msg: any): number {
  let text = '';
  if (typeof msg.content === 'string') text = msg.content;
  else if (Array.isArray(msg.content)) text = msg.content.join(' ');
  if (msg.tool_calls) {
    text += JSON.stringify(msg.tool_calls);
  }
  // role 开销 ~4 token
  return estimateTokens(text) + 4;
}

/**
 * 裁剪对话历史，确保不超过 token / 消息数上限
 *
 * 策略：
 * 1. 如果消息数 <= MAX_CONVERSATION_MESSAGES 且总 token <= MAX_CONVERSATION_TOKENS，不裁剪
 * 2. 否则从最早的消息开始丢弃（保留 system 和最新消息）
 * 3. 被丢弃的消息如果包含 tool_calls/tool 结果，一并丢弃配对
 */
function trimConversationHistory(history: Array<{ role: 'user' | 'assistant'; content: string }>): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!history || history.length === 0) return history;

  let totalTokens = history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  const msgCount = history.length;

  if (msgCount <= MAX_CONVERSATION_MESSAGES && totalTokens <= MAX_CONVERSATION_TOKENS) {
    return history;
  }

  // 需要裁剪：从头部开始丢弃
  const result = [...history];
  while (result.length > 0 && (result.length > MAX_CONVERSATION_MESSAGES || totalTokens > MAX_CONVERSATION_TOKENS)) {
    const dropped = result.shift()!;
    totalTokens -= estimateMessageTokens(dropped);
  }

  if (result.length < history.length) {
    console.log(`[AI] 对话历史裁剪: ${history.length} → ${result.length} 条 (估算 ${totalTokens} tokens)`);
  }

  return result;
}

// ============================================================================
// Agent 模式 — 工具调用循环 + 流式最终输出
// ============================================================================

/**
 * 非流式 AI 调用（支持 tools）— 收集完整响应含 tool_calls
 * 内置重试 + 模型降级
 */
async function callAIWithTools(
  messages: any[],
  tools: any[],
  temperature: number = 0.7,
  signal?: AbortSignal,
  onReasoning?: (chunk: string) => void,
): Promise<{ content: string | null; tool_calls?: any[] }> {
  return callWithRetry(async (model: string) => {
    if (isLiteLLM()) {
      const response = await callLiteLLM({
        model,
        messages,
        tools,
        temperature,
      }, signal, onReasoning);
      const msg = response.choices[0]?.message;
      return {
        content: msg?.content || null,
        tool_calls: msg?.tool_calls,
      };
    } else {
      const { signal: innerSignal, cleanup } = createAbortSignal(signal);
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages,
          tools,
          temperature,
        }, { signal: innerSignal });
        const msg = completion.choices[0].message;
        return {
          content: msg.content,
          tool_calls: msg.tool_calls as any,
        };
      } finally {
        cleanup();
      }
    }
  }, signal);
}

/**
 * 模拟流式输出 — 将已有文本以小块逐步推送
 */
async function streamText(
  text: string,
  onChunk: (chunk: string) => void,
  chunkSize: number = 12,
  delayMs: number = 1
): Promise<string> {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    onChunk(chunk);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return text;
}

/**
 * Agent 流式调用 — 两阶段架构
 *
 * Phase 1（信息收集）：AI 通过 tool calls 搜索书库，非流式，最多 N 轮
 * Phase 2（最终输出）：基于收集的信息流式生成最终回复
 *
 * 关键：使用 getAllTools() 而非硬编码 LIBRARY_TOOLS，
 * 使用 executeAllTools() 而非 executeLibraryTool()，
 * 确保所有注册工具（书库 + Web 搜索）都能被 Agent 使用。
 */
async function callAgentStream(
  systemPrompt: string,
  userPrompt: string,
  library: Book[],
  onChunk: (chunk: string) => void,
  temperature: number = 0.7,
  jsonMode: boolean = false,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  userProfile?: UserProfile,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onBookUpdate?: BookUpdateCallback,
  onReasoning?: (text: string) => void,
): Promise<string> {
  // 清空工具缓存（新请求开始）
  clearToolCache();

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
  ];
  // 注入对话历史（滑动窗口裁剪，防止上下文溢出）
  if (conversationHistory && conversationHistory.length > 0) {
    const trimmedHistory = trimConversationHistory(conversationHistory);
    for (const msg of trimmedHistory) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: userPrompt });

  // Phase 1: 工具调用循环（非流式）
  let lastContent: string | null = null;
  console.log('[AI] Agent Phase 1: 信息收集 (thinking)');
  onPhase?.('thinking');

  const MAX_ROUNDS = 3;
  // 运行时获取所有可用工具（书库工具 + 条件性 Web 工具）
  const tools = getAllTools();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const roundStart = Date.now();
    let response: { content: string | null; tool_calls?: any[] };
    try {
      response = await callAIWithTools(messages, tools, temperature, signal, onReasoning);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      console.error(`[AI] Agent round ${round + 1} 调用失败:`, e.message);
      if (round === 0) throw e;
      break;
    }
    console.log(`[AI] Agent round ${round + 1}/${MAX_ROUNDS} 完成 (${Date.now() - roundStart}ms, tools: ${response.tool_calls?.length || 0})`);

    if (response.tool_calls && response.tool_calls.length > 0) {
      // Phase 1 透明化：如果 AI 返回了思考文本（content），推送给前端
      if (response.content && response.content.trim().length > 0 && onReasoning) {
        onReasoning(response.content.trim());
      }
      // AI 请求调用工具
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.tool_calls,
      });

      // 并行执行所有工具调用（单个工具失败不影响其他）
      // 解析参数 + 通知前端
      const toolEntries = response.tool_calls.map((tc: any) => {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // arguments 解析失败，用空对象
        }
        // 通知调用方正在执行工具（立即推送，前端看到所有工具同时 running）
        if (onToolCall) {
          const label = describeToolCallUnified(tc.function.name, args);
          onToolCall(tc.function.name, label, round + 1);
        }
        return { tc, args };
      });

      // 并行执行所有工具，保证结果顺序与 tool_calls 一致
      const results = await Promise.all(
        toolEntries.map(async ({ tc, args }) => {
          const toolStart = Date.now();
          console.log(`[AI] 执行工具: ${tc.function.name} (args=${JSON.stringify(args).slice(0, 80)})`);
          try {
            // 使用统一执行器（自动路由书库工具 / Web 工具）
            const result = await executeAllTools(tc.function.name, args, library, userProfile, onBookUpdate);
            console.log(`[AI] 工具完成: ${tc.function.name} (${Date.now() - toolStart}ms)`);
            return result;
          } catch (toolErr: any) {
            console.error(`[AI] 工具失败: ${tc.function.name} - ${toolErr.message}`);
            return JSON.stringify({ error: `工具执行失败: ${toolErr.message}` });
          }
        }),
      );

      // 按原始顺序追加结果到 messages
      for (let i = 0; i < toolEntries.length; i++) {
        messages.push({
          role: 'tool',
          content: results[i],
          tool_call_id: toolEntries[i].tc.id,
        });
      }
      // 继续下一轮，让 AI 处理工具结果
    } else {
      // AI 不再调用工具 — 信息收集阶段结束
      lastContent = response.content;
      break;
    }
  }

  // Phase 2: 流式生成最终回复
  console.log('[AI] Agent Phase 2: 生成最终回复 (generating)');
  onPhase?.('generating');

  // 如果 Phase 1 的最后一轮已经生成了完整内容，直接输出（跳过 Phase 2 冗余调用）
  if (lastContent && lastContent.trim().length > 0) {
    if (jsonMode) {
      // JSON 模式：验证 Phase 1 内容是否可解析为 JSON
      const trimmed = lastContent.trim();
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        try {
          JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
          console.log('[AI] Phase 1 已生成有效 JSON，跳过 Phase 2');
          return streamText(lastContent, onChunk);
        } catch {
          console.log('[AI] Phase 1 内容非有效 JSON，进入 Phase 2 重新生成');
        }
      } else {
        console.log('[AI] Phase 1 内容不含 JSON 结构，进入 Phase 2 重新生成');
      }
    } else {
      return streamText(lastContent, onChunk);
    }
  }

  // 否则，追加一条 user 消息，引导 AI 生成最终回复
  const finalMessages = [
    ...messages,
    {
      role: 'user',
      content: jsonMode
        ? '请基于以上信息，生成最终的 JSON 格式回复。直接输出 JSON，不要包含其他内容。'
        : '请基于以上信息，生成最终的回复。',
    },
  ];

  if (isLiteLLM()) {
    const url = process.env.LITELLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions';
    const apiKey = process.env.LITELLM_API_KEY!;
    const body: any = {
      model: getModel(),
      messages: finalMessages,
      temperature,
      stream: true,
    };
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const { signal: innerSignal, reset: resetIdle, cleanup } = createIdleAbortSignal(signal);
    let fullContent = '';
    let buffer = '';

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: innerSignal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LiteLLM stream failed: ${response.status} ${error}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        try {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdle();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              if (jsonStr === '[DONE]') continue;
              try {
                const chunk = JSON.parse(jsonStr);
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  onChunk(content);
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') break;
          break;
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return fullContent;
      }
      throw e;
    } finally {
      cleanup();
    }

    return fullContent;
  } else {
    // DeepSeek SDK 流式
    const { signal: innerSignal, cleanup } = createAbortSignal(signal);
    const params: any = {
      model: getModel(),
      messages: finalMessages,
      temperature,
      stream: true,
    };
    if (jsonMode) {
      params.response_format = { type: 'json_object' };
    }

    let fullContent = '';
    try {
      const stream = await openai.chat.completions.create(params, { signal: innerSignal }) as any;
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullContent += content;
          onChunk(content);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return fullContent;
      }
      throw e;
    } finally {
      cleanup();
    }

    return fullContent;
  }
}

// ============================================================================
// JSON 解析 + 容错修复
// ============================================================================

/**
 * 核心 JSON 解析器 - 处理 AI 不稳定的输出
 */
function parseAIJSON<T>(content: string | null): T {
  if (!content) {
    throw new Error('AI 返回内容为空');
  }

  let clean = content.trim();

  // 1. 优先提取 Markdown 代码块
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = clean.match(codeBlockRegex);
  if (match && match[1]) {
    clean = match[1].trim();
  }

  // 2. 寻找最外层的 {}
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    clean = clean.substring(firstBrace, lastBrace + 1);
  } else {
    throw new Error('AI 返回内容不包含有效的 JSON 数据格式');
  }

  try {
    return JSON.parse(clean) as T;
  } catch (e: any) {
    // 3. 容错修复：尝试修复常见的 JSON 格式错误
    console.warn('[AI] JSON 解析失败，尝试容错修复:', e.message);
    const repaired = repairJSON(clean);
    if (repaired) {
      try {
        const result = JSON.parse(repaired);
        console.warn('[AI] JSON 容错修复成功');
        return result as T;
      } catch {
        // 修复仍然失败
      }
    }
    // 4. 最终降级：尝试提取已知字段，返回部分结果
    const partial = extractPartialJSON<T>(clean);
    if (partial) {
      console.warn('[AI] JSON 降级提取部分字段成功');
      return partial;
    }
    console.error('JSON Parse Error:', e);
    console.error('Cleaned Content (first 500 chars):', clean.substring(0, 500));
    throw new Error('AI 返回的 JSON 格式有语法错误');
  }
}

/**
 * 从损坏的 JSON 中尝试提取已知字段（最终降级方案）
 *
 * 当 JSON.parse 和 repairJSON 都失败时，用正则提取常见字段，
 * 返回部分结果而不是完全失败。
 */
function extractPartialJSON<T>(content: string): T | null {
  try {
    const result: Record<string, any> = {};

    // 提取字符串字段: "key": "value"
    const stringFieldRegex = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = stringFieldRegex.exec(content)) !== null) {
      const key = match[1];
      const value = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      if (!result[key]) {
        result[key] = value;
      }
    }

    // 提取数组字段: "key": ["item1", "item2", ...]
    const arrayFieldRegex = /"(\w+)"\s*:\s*\[([\s\S]*?)\]/g;
    while ((match = arrayFieldRegex.exec(content)) !== null) {
      const key = match[1];
      const arrayContent = match[2];
      const items = arrayContent.match(/"((?:[^"\\]|\\.)*)"/g);
      if (items) {
        result[key] = items.map(item => item.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"'));
      }
    }

    // 提取数字字段: "key": 123
    const numberFieldRegex = /"(\w+)"\s*:\s*(\d+(?:\.\d+)?)/g;
    while ((match = numberFieldRegex.exec(content)) !== null) {
      const key = match[1];
      if (!result[key]) {
        result[key] = parseFloat(match[2]);
      }
    }

    // 如果至少提取到了一个字段，返回部分结果
    if (Object.keys(result).length > 0) {
      console.warn(`[AI] 部分字段提取: ${Object.keys(result).join(', ')}`);
      return result as T;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 尝试修复常见的 JSON 格式错误
 */
function repairJSON(str: string): string | null {
  try {
    let repaired = str;
    // 移除单行注释
    repaired = repaired.replace(/\/\/.*$/gm, '');
    // 移除多行注释
    repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');
    // 修复尾部逗号（} 或 ] 前的逗号）
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    // 修复中文引号
    repaired = repaired.replace(/\u201c/g, '"').replace(/\u201d/g, '"');
    // 修复单引号为双引号
    repaired = repaired.replace(/'/g, '"');
    return repaired;
  } catch {
    return null;
  }
}

// ============================================================================
// 非流式 API 函数
// ============================================================================

/**
 * 书籍批量分类
 */
export async function classifyBooks(
  titles: string[],
  existingCategories: string[] = []
): Promise<Partial<Book>[]> {
  const messages = [
    { role: 'system' as const, content: BOOK_CLASSIFIER_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildBookClassifierUserPrompt({ titles, existingCategories }) }
  ];

  let content: string | null;

  if (isLiteLLM()) {
    const response = await callLiteLLM({
      model: getModel(),
      messages,
      temperature: 0.3,
    });
    content = response.choices[0]?.message?.content || null;
  } else {
    const completion = await openai.chat.completions.create({
      model: getModel(),
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    content = completion.choices[0].message.content;
  }

  const data = parseAIJSON<{ books: Partial<Book>[] }>(content);

  if (!data.books || !Array.isArray(data.books)) {
    throw new Error('AI 返回数据格式错误');
  }

  return data.books;
}

/**
 * 个性化阅读推荐（支持分级对话）
 */
export async function getRecommendations(
  context: AIRequestContext
): Promise<AIResponse> {
  const content = await callAI([
    { role: 'system', content: READING_ADVISOR_SYSTEM_PROMPT },
    { role: 'user', content: buildReadingAdvisorUserPrompt(context) }
  ], 0.7);

  return parseAIJSON<AIResponse>(content);
}

/**
 * 分类专项对话
 */
export async function getCategoryFocusedAdvice(
  category: string,
  subcategory: string | undefined,
  books: Book[],
  userQuestion: string
): Promise<AIResponse> {
  const content = await callAI([
    { role: 'system', content: READING_ADVISOR_SYSTEM_PROMPT + '\n\n【特殊指令】用户正在特定分类下咨询，请专注于该领域的书籍。' },
    { role: 'user', content: buildCategoryFocusedPrompt(category, subcategory, books, userQuestion) }
  ], 0.5);

  return parseAIJSON<AIResponse>(content);
}

/**
 * 生成书籍深度解读
 */
export async function generateInsight(
  title: string,
  author: string,
  level: BookLevel,
  category?: string,
  subcategory?: string,
  totalPages?: number,
  doubanData?: {
    rating?: number;
    ratingCount?: number;
    summary?: string;
    tags?: string[];
    publisher?: string;
    pubdate?: string;
  }
): Promise<AIInsight> {
  console.log(`[AI] 生成书籍解读: ${title}, 难度: ${level}`);
  console.log(`[AI] 豆瓣数据:`, doubanData ? {
    rating: doubanData.rating,
    hasSummary: !!doubanData.summary,
    tagsCount: doubanData.tags?.length || 0
  } : '无');
  
  const content = await callAI([
    { role: 'system', content: INSIGHT_GENERATOR_SYSTEM_PROMPT },
    { role: 'user', content: buildInsightGeneratorUserPrompt({ title, author, level, category, subcategory, totalPages, doubanData }) }
  ], 0.4);

  console.log(`[AI] 原始响应:`, content?.substring(0, 200) + '...');
  
  const result = parseAIJSON<AIInsight>(content);
  console.log(`[AI] 解析结果:`, {
    hasSummary: !!result.summary,
    hasAdvice: !!result.advice,
    keyChaptersCount: result.keyChapters?.length || 0
  });
  
  return result;
}

/**
 * 规划阅读路径
 */
export async function generateReadingPath(
  books: Book[],
  category: string,
  subcategory?: string,
  customRequirements?: string
): Promise<ReadingPathResponse> {
  const simplifiedBooks = books.map(b => ({
    id: b.id,
    title: b.title,
    author: b.author,
    level: b.level,
    status: b.status,
    summary: b.aiInsight?.summary?.slice(0, 100)
  }));

  const systemPrompt = `你是一个高级课程设计师，擅长规划学习路径。

请根据书籍的难度、内容依赖关系、用户的阅读状态，规划最佳阅读顺序。

排序原则：
1. 难度递进：Basic -> Advanced -> Expert
2. 内容依赖：基础理论在前，应用实践在后
3. 状态优先：正在阅读的书优先，未读的书按逻辑排序
4. 用户目标：如果用户有特定目标，优先满足

输出 JSON 格式：
{
  "sortedBookIds": ["id1", "id2", ...],
  "reasoning": "详细的规划理由",
  "estimatedTotalDays": 90,
  "pathStages": [
    {
      "stage": 1,
      "bookIds": ["id1"],
      "theme": "该阶段主题",
      "description": "阶段描述"
    }
  ]
}`;

  const userPrompt = `请为以下书籍规划阅读路径。

领域: ${category}${subcategory ? ` > ${subcategory}` : ''}
${customRequirements ? `用户目标: ${customRequirements}` : ''}

书籍列表:
${JSON.stringify(simplifiedBooks, null, 2)}`;

  const content = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 0.3);

  return parseAIJSON<ReadingPathResponse>(content);
}

/**
 * 智能整理书库分类
 */
export async function reorganizeLibrary(
  books: Book[]
): Promise<Record<string, { category: string; subcategory: string; tags?: string[] }>> {
  const systemPrompt = `你是一个图书馆分类专家。

请对书籍进行重新归类，建立清晰的分类体系。

要求：
1. 合并语义重复的分类
2. 保持分类数量适中（5-10个一级分类）
3. 每个分类下的子分类清晰
4. 为每本书添加合适的标签

输出 JSON 格式：
{
  "mapping": [
    {
      "bookId": "id",
      "category": "一级分类",
      "subcategory": "二级分类",
      "tags": ["标签1", "标签2"]
    }
  ]
}`;

  const userPrompt = `请重新分类以下书籍：\n\n${JSON.stringify(
    books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      currentCategory: b.category,
      currentSubcategory: b.subcategory,
      summary: b.aiInsight?.summary?.slice(0, 80)
    })),
    null,
    2
  )}`;

  const content = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], 0.3);

  const data = parseAIJSON<{ mapping: Array<{ bookId: string; category: string; subcategory: string; tags?: string[] }> }>(
    content
  );

  const result: Record<string, { category: string; subcategory: string; tags?: string[] }> = {};
  data.mapping.forEach(item => {
    result[item.bookId] = {
      category: item.category,
      subcategory: item.subcategory,
      tags: item.tags
    };
  });

  return result;
}

// ============================================================================
// 流式 API 函数 — SSE + Agent 循环
// ============================================================================

/**
 * 流式个性化推荐 — 深度个性化模式
 *
 * 优化要点：
 * 1. 使用增强版 System Prompt（含深度理解框架）
 * 2. 通过工具说明模板统一管理工具描述
 * 3. 构建丰富的用户上下文（书库概览 + 品味画像 + 用户画像 + 对话历史）
 * 4. 引导 AI 优先使用分析型工具（品味画像、知识缺口）
 */
export async function getRecommendationsStream(
  context: AIRequestContext,
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<AIResponse> {
  // 使用 withTools 统一构建工具说明（包含新增的分析型工具）
const systemPrompt = withTools(
READING_ADVISOR_SYSTEM_PROMPT,
3,
`书库概览和阅读品味画像已在上下文中提供。如需更详细的信息，可使用工具查询（最多3轮），但不要为了使用工具而使用工具——如果已有信息足够回答，直接给出推荐。`,
);

  let userPrompt = buildLibraryOverview(context.library);

  if (context.userProfile) {
    userPrompt += `\n\n【用户画像】\n`;
    userPrompt += `水平: ${context.userProfile.readingLevel}\n`;
    if (context.userProfile.readingGoal) userPrompt += `目标: ${context.userProfile.readingGoal}\n`;
    if (context.userProfile.preferredCategories?.length) userPrompt += `偏好: ${context.userProfile.preferredCategories.join(', ')}\n`;
    if (context.userProfile.dailyReadingTime) userPrompt += `每日阅读时间: ${context.userProfile.dailyReadingTime} 分钟\n`;
    if (context.userProfile.aiAnalysis) {
      userPrompt += `AI分析: ${context.userProfile.aiAnalysis.readingPattern}\n`;
      userPrompt += `盲区: ${context.userProfile.aiAnalysis.blindSpots.join(', ')}\n`;
      userPrompt += `建议方向: ${context.userProfile.aiAnalysis.recommendedFocus}\n`;
    }
  }

  if (context.categoryContext) {
    const cc = context.categoryContext;
    userPrompt += `\n\n【分类上下文】\n`;
    userPrompt += `当前分类: ${cc.currentCategory}\n`;
    userPrompt += `分类统计: 共 ${cc.totalBooks} 本（在读 ${cc.readingStats.reading}, 已读 ${cc.readingStats.finished}, 未读 ${cc.readingStats.unread}）\n`;
    if (cc.subCategories.length > 0) {
      userPrompt += `子分类: ${cc.subCategories.join(', ')}\n`;
    }
    userPrompt += `提示：请优先在该分类范围内推荐，但如发现知识缺口可适当推荐跨分类书籍。\n`;
  }

  // 对话历史（多轮推荐上下文）
  if (context.conversationHistory && context.conversationHistory.length > 0) {
    userPrompt += `\n【对话历史】\n`;
    for (const msg of context.conversationHistory.slice(-4)) {
      userPrompt += `${msg.role === 'user' ? '用户' : '助手'}：${msg.content.slice(0, 150)}\n`;
    }
  }

  userPrompt += `\n【用户请求】\n${context.userRequest}`;
  if (context.userMood) userPrompt += `\n当前心情: ${context.userMood}`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, context.library, onChunk, 0.7, true,
    onPhase, context.conversationHistory?.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    context.userProfile, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON<AIResponse>(content);
}

/**
 * 流式生成书籍解读 — Agent 模式
 */
export async function generateInsightStream(
  title: string, author: string, level: BookLevel,
  category?: string, subcategory?: string, totalPages?: number,
  doubanData?: {
    rating?: number; ratingCount?: number; summary?: string;
    tags?: string[]; publisher?: string; pubdate?: string;
  },
  onChunk?: (chunk: string) => void,
  library?: Book[],
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<AIInsight> {
  if (library && library.length > 0) {
const systemPrompt = withTools(
INSIGHT_GENERATOR_SYSTEM_PROMPT,
2,
`书库信息已在上下文中提供。如需查找相关书籍可使用工具，但已有信息足够时直接生成解读。`,
);

    let userPrompt = `请为以下书籍生成深度解读：\n\n`;
    userPrompt += `书名: 《${title}》\n作者: ${author}\n难度: ${level}\n`;
    if (category) userPrompt += `分类: ${category}${subcategory ? ` > ${subcategory}` : ''}\n`;
    if (totalPages) userPrompt += `页数: ${totalPages} 页\n`;
    if (doubanData) {
      userPrompt += `\n## 豆瓣数据参考\n`;
      if (doubanData.rating) userPrompt += `豆瓣评分: ${doubanData.rating}/10 (${doubanData.ratingCount || '未知'} 人评价)\n`;
      if (doubanData.publisher) userPrompt += `出版社: ${doubanData.publisher}\n`;
      if (doubanData.pubdate) userPrompt += `出版日期: ${doubanData.pubdate}\n`;
      if (doubanData.summary) {
        const summary = doubanData.summary.length > 500 ? doubanData.summary.substring(0, 500) + '...' : doubanData.summary;
        userPrompt += `内容简介: ${summary}\n`;
      }
      if (doubanData.tags && doubanData.tags.length > 0) {
        userPrompt += `标签: ${doubanData.tags.slice(0, 8).join(', ')}\n`;
      }
    }
    userPrompt += `\n${buildLibraryOverview(library)}`;
    userPrompt += `\n请结合书库信息生成解读，在建议中可以提及用户书库中的相关书籍。`;

    const content = await callAgentStream(
      systemPrompt, userPrompt, library, onChunk || (() => {}), 0.4, true,
      onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
    );
    return parseAIJSON<AIInsight>(content);
  }

  // 无书库时，回退到普通流式模式
  const content = await callAIStream([
    { role: 'system', content: INSIGHT_GENERATOR_SYSTEM_PROMPT },
    { role: 'user', content: buildInsightGeneratorUserPrompt({ title, author, level, category, subcategory, totalPages, doubanData }) }
  ], onChunk || (() => {}), 0.4, signal);
  return parseAIJSON<AIInsight>(content);
}

/**
 * 流式规划阅读路径 — Agent 模式
 */
export async function generateReadingPathStream(
  books: Book[], category: string, subcategory?: string, customRequirements?: string,
  onChunk?: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<ReadingPathResponse> {
const systemPrompt = withTools(
READING_PATH_SYSTEM_PROMPT,
2,
`如需获取书籍详情或分类信息可使用工具，但已有信息足够时直接规划路径。`,
);

  let userPrompt = `请为以下书籍规划阅读路径。\n\n`;
  userPrompt += `领域: ${category}${subcategory ? ` > ${subcategory}` : ''}\n`;
  if (customRequirements) userPrompt += `用户目标: ${customRequirements}\n`;
  userPrompt += `\n${buildLibraryOverview(books)}`;
  userPrompt += `\n请使用 get_book_details 工具获取这些书籍的详细信息，然后规划路径。`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, books, onChunk || (() => {}), 0.3, true,
    onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON<ReadingPathResponse>(content);
}

/**
 * 书籍问答 — 流式对话（Agent 模式）
 */
export async function chatWithBookStream(
  question: string,
  bookContext: {
    title: string; author: string;
    category?: string; subcategory?: string; level?: string;
    aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
    doubanData?: { summary?: string; rating_score?: number; tags?: string[] };
    readingProgress?: { currentPage: number; totalPages: number; percentage: number };
  },
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  library?: Book[],
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  onBookUpdate?: BookUpdateCallback,
  onReasoning?: (text: string) => void,
): Promise<string> {
  if (library && library.length > 0) {
    const messages = buildBookQAContext(
      bookContext.title, bookContext.author, bookContext.category, bookContext.subcategory,
      bookContext.level, bookContext.aiInsight, bookContext.doubanData, bookContext.readingProgress,
      conversationHistory
    );
    const systemContent = messages[0]?.content || BOOK_QA_SYSTEM_PROMPT;
    const systemPrompt = withTools(
      systemContent,
      3,
      `当用户问题涉及书库中的其他书籍、同类书籍对比、延伸阅读推荐时，请使用工具查找相关信息。
如果问题只关于当前书籍，不需要调用工具。`,
    );

    let userPrompt = '';
    if (conversationHistory && conversationHistory.length > 0) {
      userPrompt += `【对话历史】\n`;
      for (const msg of conversationHistory.slice(-6)) {
        userPrompt += `${msg.role === 'user' ? '用户' : '助手'}：${msg.content.slice(0, 200)}\n`;
      }
      userPrompt += '\n';
    }
    userPrompt += `【当前问题】\n${question}\n`;
    userPrompt += `\n${buildLibraryOverview(library)}`;

    const content = await callAgentStream(
      systemPrompt, userPrompt, library, onChunk, 0.7, false,
      onPhase, undefined, undefined, onToolCall, signal, onBookUpdate, onReasoning
    );
    return content;
  }

  // 无书库时，回退到普通流式模式
  const messages = buildBookQAContext(
    bookContext.title, bookContext.author, bookContext.category, bookContext.subcategory,
    bookContext.level, bookContext.aiInsight, bookContext.doubanData, bookContext.readingProgress,
    conversationHistory
  );
  messages.push({ role: 'user', content: question });
  return callAIStream(messages, onChunk, 0.7, signal);
}

/**
 * 阅读洞察 — 流式 Agent
 */
export async function generateReadingInsightsStream(
  data: {
    totalBooks: number; readingCount: number; finishedCount: number; unreadCount: number;
    totalPagesRead: number; avgRating: number;
    categoryDistribution: Array<{ category: string; count: number }>;
    levelDistribution: { Basic: number; Advanced: number; Expert: number };
    readingBooks: Array<{ title: string; author: string; progress: number; category: string }>;
    finishedBooks: Array<{ title: string; author: string; category: string }>;
  },
  library: Book[],
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<any> {
const systemPrompt = withTools(
READING_INSIGHTS_SYSTEM_PROMPT,
2,
`阅读品味画像已在上下文中提供。如需更详细的信息可使用工具，但已有信息足够时直接生成洞察。`,
);

  let userPrompt = `请根据以下阅读数据生成个性化洞察：\n\n`;
  userPrompt += `藏书：${data.totalBooks} 本（在读 ${data.readingCount}，已读 ${data.finishedCount}，未读 ${data.unreadCount}）\n`;
  userPrompt += `累计页数：${data.totalPagesRead}\n`;
  userPrompt += `平均评分：${data.avgRating.toFixed(1)}\n\n`;
  userPrompt += `分类分布：${data.categoryDistribution.slice(0, 10).map(c => `${c.category}(${c.count})`).join(', ')}\n`;
  userPrompt += `难度分布：入门 ${data.levelDistribution.Basic}、进阶 ${data.levelDistribution.Advanced}、专家 ${data.levelDistribution.Expert}\n`;
  if (data.readingBooks.length > 0) {
    userPrompt += `\n正在阅读：\n`;
    for (const b of data.readingBooks.slice(0, 5)) {
      userPrompt += `  《${b.title}》(${b.category}, 进度 ${b.progress.toFixed(0)}%)\n`;
    }
  }
  userPrompt += `\n提示：使用工具可以查看已读书籍历史、获取书籍详情、查看分类统计。`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.6, true,
    onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON(content);
}

/**
 * 用户画像分析 — 流式 Agent
 */
export async function analyzeUserProfileStream(
  data: {
    totalBooks: number; readingCount: number; finishedCount: number; unreadCount: number;
    totalPagesRead: number;
    categoryDistribution: Array<{ category: string; count: number }>;
    levelDistribution: { Basic: number; Advanced: number; Expert: number };
    readingBooks: Array<{ title: string; author: string; progress: number; category: string; level: string }>;
    finishedBooks: Array<{ title: string; author: string; category: string; level: string }>;
    currentProfile?: {
      readingLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
      readingGoal?: string;
      preferredCategories: string[];
    };
  },
  library: Book[],
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<any> {
const systemPrompt = withTools(
PROFILE_ANALYSIS_SYSTEM_PROMPT,
2,
`阅读品味画像已在上下文中提供。如需更详细的信息可使用工具，但已有信息足够时直接给出分析。`,
);

  let userPrompt = `请分析以下用户的阅读数据：\n\n`;
  userPrompt += `藏书：${data.totalBooks} 本（在读 ${data.readingCount}，已读 ${data.finishedCount}，未读 ${data.unreadCount}）\n`;
  userPrompt += `累计页数：${data.totalPagesRead}\n\n`;
  userPrompt += `分类分布：${data.categoryDistribution.slice(0, 10).map(c => `${c.category}(${c.count})`).join(', ')}\n`;
  userPrompt += `难度分布：入门 ${data.levelDistribution.Basic}、进阶 ${data.levelDistribution.Advanced}、专家 ${data.levelDistribution.Expert}\n`;
  if (data.readingBooks.length > 0) {
    userPrompt += `\n正在阅读：\n`;
    for (const b of data.readingBooks.slice(0, 5)) {
      userPrompt += `  《${b.title}》(${b.level}, ${b.category}, 进度 ${b.progress.toFixed(0)}%)\n`;
    }
  }
  if (data.currentProfile) {
    userPrompt += `\n用户当前自评：\n`;
    userPrompt += `水平：${data.currentProfile.readingLevel}\n`;
    if (data.currentProfile.readingGoal) userPrompt += `目标：${data.currentProfile.readingGoal}\n`;
    if (data.currentProfile.preferredCategories.length > 0) {
      userPrompt += `偏好：${data.currentProfile.preferredCategories.join('、')}\n`;
    }
  }
  userPrompt += `\n提示：使用工具可以查看已读书籍历史、获取书籍详情、查看分类统计。`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.5, true,
    onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON(content);
}

/**
 * 书籍对比 — 流式 Agent
 */
export async function compareBooksStream(
  books: any[],
  library: Book[],
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<any> {
const systemPrompt = withTools(
BOOK_COMPARISON_SYSTEM_PROMPT,
2,
`如需获取书籍详情可使用工具，但已有信息足够时直接生成对比分析。`,
);

  let userPrompt = buildBookComparisonUserPrompt(books);
  userPrompt += `\n${buildLibraryOverview(library)}`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.4, true,
    onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON(content);
}

/**
 * 读书总结 — 流式 Agent
 */
export async function generateReadingSummaryStream(
  data: {
    title: string; author: string;
    category?: string; subcategory?: string; level?: string;
    totalPages?: number; rating?: number;
    aiInsight?: { summary?: string; advice?: string; keyChapters?: string[] };
    doubanData?: { rating_score?: number; summary?: string; tags?: string[] };
    readingProgress?: { startDate?: string; completionDate?: string; totalPages?: number };
    userProfile?: { readingLevel?: string; readingGoal?: string; preferredCategories?: string[] };
  },
  library: Book[],
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<any> {
const systemPrompt = withTools(
READING_SUMMARY_SYSTEM_PROMPT,
2,
`如需查找相关书籍可使用工具，但已有信息足够时直接生成总结。`,
);

  const relatedBooks = library
    .filter(b => b.id !== data.title &&
      (b.category === data.category ||
        b.subcategory === data.subcategory ||
        b.author === data.author))
    .slice(0, 5)
    .map(b => ({ title: b.title, author: b.author, category: b.category }));

  let userPrompt = buildReadingSummaryUserPrompt({ ...data, relatedBooks });
  userPrompt += `\n${buildLibraryOverview(library)}`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.5, true,
    onPhase, undefined, data.userProfile as any, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON(content);
}

// ============================================================================
// 笔记整理 — 流式 Agent
// ============================================================================

/**
 * 笔记整理结果类型
 */
export interface NoteOrganizerResult {
  summary: string;
  themes: Array<{
    theme: string;
    notes: string[];
    insight: string;
  }>;
  keyConcepts: string[];
  questions: string[];
  readingProgress: string;
}

/**
 * 流式笔记整理 — Agent 模式
 */
export async function organizeNotesStream(
  data: {
    bookTitle: string;
    bookAuthor?: string;
    notes: Array<{ id: number; content: string; type?: string }>;
  },
  library: Book[],
  onChunk: (chunk: string) => void,
  onPhase?: (phase: 'thinking' | 'generating') => void,
  onToolCall?: (toolName: string, label: string, round: number) => void,
  signal?: AbortSignal,
  onReasoning?: (text: string) => void,
): Promise<NoteOrganizerResult> {
  const systemPrompt = withTools(
    NOTE_ORGANIZER_SYSTEM_PROMPT,
    2,
    `整理笔记时如需了解书籍详情或查找相关书籍，可以使用工具。如果笔记内容清晰，不需要调用工具。`,
  );

  let userPrompt = buildNoteOrganizerUserPrompt(data);
  if (library && library.length > 0) {
    userPrompt += '\n' + buildLibraryOverview(library);
  }

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.4, true,
    onPhase, undefined, undefined, onToolCall, signal, undefined, onReasoning
  );
  return parseAIJSON<NoteOrganizerResult>(content);
}

// ============================================================================
// 全局阅读助手 — 流式 Agent
// ============================================================================

/**
 * 全局阅读助手 — 跨书库自由对话
 *
 * 与 BookQA 的区别：不绑定单本书，可自由提问任何阅读相关问题
 */
export async function readingAssistantStream(
  question: string,
  library: Book[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  userProfile: UserProfile | undefined,
  onChunk: (chunk: string) => void,
  onPhase: (phase: 'thinking' | 'generating') => void,
  onToolCall: (toolName: string, label: string, round: number) => void,
  onReasoning: (text: string) => void,
  signal?: AbortSignal,
  onBookUpdate?: BookUpdateCallback,
): Promise<string> {
  const systemPrompt = withTools(
    `你是一位智能阅读管家，帮助用户管理书库、推荐书籍、分析阅读习惯。

你的能力：
1. 搜索和查询用户书库中的书籍
2. 获取书籍详细信息（AI解读、豆瓣评分、阅读进度等）
3. 查看分类统计和阅读历史
4. 分析用户阅读品味画像（get_reading_taste_profile）
5. 识别知识缺口和盲区（get_reading_gaps）
6. 了解用户画像，提供个性化建议
7. 更新书籍阅读状态
8. 搜索互联网获取最新书籍信息（如果可用）

回答原则：
- 推荐书籍前，建议先用 get_reading_taste_profile 了解用户的阅读品味
- 发现用户知识结构问题时，用 get_reading_gaps 分析缺口
- 优先使用书库工具查找信息，确保推荐基于用户已有藏书
- 回答要简洁有用，避免冗长的废话
- 给出推荐时要说明"为什么是现在读这本"
- 如果用户问的书不在书库中，可以使用 web_search 查找
- 支持多轮对话，记住上下文`,
    5,
    `当用户询问"读什么书"时，请按以下步骤操作：
1. 先用 get_reading_taste_profile 了解用户阅读品味
2. 再用 get_reading_gaps 分析知识缺口
3. 基于品味和缺口，给出有针对性的推荐`,
  );

  let userPrompt = buildLibraryOverview(library);
  if (userProfile) {
    userPrompt += `\n【用户画像】\n`;
    userPrompt += `水平: ${userProfile.readingLevel}\n`;
    if (userProfile.readingGoal) userPrompt += `目标: ${userProfile.readingGoal}\n`;
    if (userProfile.preferredCategories?.length) userPrompt += `偏好: ${userProfile.preferredCategories.join(', ')}\n`;
  }
  userPrompt += `\n【用户问题】\n${question}`;

  const content = await callAgentStream(
    systemPrompt, userPrompt, library, onChunk, 0.7, false,
    onPhase, conversationHistory, userProfile, onToolCall, signal, onBookUpdate, onReasoning
  );
  return content;
}
