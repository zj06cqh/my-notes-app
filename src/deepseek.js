// DeepSeek API 封装模块 —— 纯逻辑，不碰界面。
// 用 OpenAI 兼容的 chat/completions 接口调用 DeepSeek。
// API Key 不写死在代码里，从项目根目录的 .env 读取。

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

// 固定 system 提示词放最前面，内容不变（利于服务端命中缓存省 token）。
// 注意：DeepSeek 的 json_object 模式要求提示词里出现 "json" 字样。
const SYSTEM_PROMPT = [
  '你是一名笔记复习助手。根据用户提供的笔记标题和内容，生成两样东西：一个简要总结，一个能帮助回忆内容的问题。',
  '你必须只输出一个 JSON 对象（json object），不要输出任何其他文字、解释、markdown 代码块标记。',
  '输出格式如下：',
  '{"summary":"一句话简要总结","question":"一个帮助回忆的提问"}'
].join('\n');

// 从 .env 读 API Key（不写死）
function loadApiKey() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error('未找到 .env 文件。请复制 .env.example 为 .env，并填入 DEEPSEEK_API_KEY。');
  }
  const text = fs.readFileSync(ENV_PATH, 'utf-8');
  const m = /^DEEPSEEK_API_KEY\s*=\s*([^\r\n]+)/m.exec(text);
  let key = m ? m[1].trim() : '';
  key = key.replace(/^["']|["']$/g, '');
  if (!key) {
    throw new Error('.env 里缺少 DEEPSEEK_API_KEY（或值为空）。');
  }
  return key;
}

// 输入标题 + 内容，返回 { summary, question, usage }
async function generate(title, content) {
  const apiKey = loadApiKey();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `标题：${title}\n内容：\n${content}` }
  ];

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      stream: false
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`DeepSeek API 错误 (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }

  const text = data.choices?.[0]?.message?.content ?? '';

  // 解析模型返回的 JSON（容错：若带代码块则提取花括号内容）
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const block = text.match(/\{[\s\S]*\}/);
    parsed = block ? JSON.parse(block[0]) : {};
  }

  return {
    summary: parsed.summary ?? '',
    question: parsed.question ?? '',
    usage: data.usage ?? null // { prompt_tokens, completion_tokens, total_tokens }
  };
}

module.exports = { generate };
