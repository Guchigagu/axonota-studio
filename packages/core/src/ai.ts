import type { ModelConfig } from "./types";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** 纯文本消息用 string；带图片（试卷照片、作答截图）时用 parts 数组 */
  content: string | ChatContentPart[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 拿到 finish_reason，用于区分「模型乱写」与「输出被截断」 */
  onFinish?: (reason: string | undefined) => void;
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/chat/completions`;
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export async function chatComplete(
  fetchFn: FetchLike,
  model: ModelConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const res = await fetchFn(endpoint(model.baseUrl), {
    method: "POST",
    headers: headers(model.apiKey),
    body: JSON.stringify({
      model: model.modelId,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = json.choices?.[0];
  options.onFinish?.(choice?.finish_reason);
  return choice?.message?.content ?? "";
}

/** OpenAI 兼容的 SSE 流；返回逐段文本。 */
export async function* chatStream(
  fetchFn: FetchLike,
  model: ModelConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<string> {
  const res = await fetchFn(endpoint(model.baseUrl), {
    method: "POST",
    headers: headers(model.apiKey),
    body: JSON.stringify({
      model: model.modelId,
      messages,
      temperature: options.temperature ?? 0.5,
      stream: true,
    }),
    signal: options.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // 单个分片解析失败不影响整体
      }
    }
  }
}

/** 拉取服务商可用模型列表（OpenAI 兼容的 GET /models）；失败时抛可读错误 */
export async function listModels(
  fetchFn: FetchLike,
  model: Pick<ModelConfig, "baseUrl" | "apiKey">,
): Promise<string[]> {
  const base = model.baseUrl.trim().replace(/\/+$/, "");
  const url = base.endsWith("/models") ? base : `${base}/models`;
  const res = await fetchFn(url, { headers: headers(model.apiKey) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((d) => d.id)
    .filter((id): id is string => !!id)
    .sort((a, b) => a.localeCompare(b));
}

/** 添加模型前的连通性测试：最小请求，不产生内容（§2.6 约定 4） */
export async function testConnection(
  fetchFn: FetchLike,
  model: Pick<ModelConfig, "baseUrl" | "apiKey" | "modelId">,
): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await chatComplete(
      fetchFn,
      { ...model, id: "test", name: "test", createdAt: "" } as ModelConfig,
      [{ role: "user", content: "ping" }],
      { maxTokens: 1, temperature: 0 },
    );
    return { ok: true, message: text ? "连通" : "连通（空响应）" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 模型偶尔会写出全角逗号/冒号、字符串里的裸换行，或对象末尾多一个逗号。
 * 这些都不影响语义，扫描一遍（只在字符串外改标点）再解析，避免整次生成失败。
 */
function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        if ('"\\/bfnrt'.includes(ch)) {
          out += ch;
        } else if (ch === "u") {
          // \u 必须是四位十六进制，否则按字面反斜杠处理
          const hex = text.slice(i + 1, i + 5);
          out += /^[0-9a-fA-F]{4}$/.test(hex) ? ch : "\\" + ch;
        } else {
          // 数学公式里的 \(、\{ 等在 JSON 里是非法转义，补成字面反斜杠
          out += "\\" + ch;
        }
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      // 字符串外的 // 行注释：直接丢到行尾
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? text.length : nl - 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      // 字符串外的 /* */ 块注释
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 1;
    } else if (ch === "，") {
      out += ",";
    } else if (ch === "：") {
      out += ":";
    } else if (ch === ",") {
      // 字符串外、后面只剩 } 或 ] 的逗号直接去掉
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] !== "}" && text[j] !== "]") out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 从模型返回里抽出 JSON（容忍 ```json 围栏、前后缀说明与常见格式瑕疵） */
export function extractJson<T>(raw: string): T {
  if (!raw.trim()) throw new Error("模型返回了空内容（接口异常或被拒答），请重试或换一个模型");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const candidates = [candidate];
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(candidate.slice(start, end + 1));
  for (const text of candidates) {
    for (const variant of [text, repairJson(text)]) {
      try {
        return JSON.parse(variant) as T;
      } catch {
        // 换下一种写法再试
      }
    }
  }
  throw new Error("模型未返回可解析的 JSON（可能被截断或夹了说明文字），请重试或换一个模型");
}
