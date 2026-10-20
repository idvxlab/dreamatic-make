export const PI_VERSION = "1.3.0";
export interface Field {
  key: string;
  group: "model" | "system" | "appearance" | "image";
  label: [string, string];
  help?: [string, string];
  type: "text" | "url" | "number" | "select";
  default: string;
  options?: string[];
  min?: number;
  max?: number;
}
export const fields: Field[] = [
  ...([
    ["imageProtocol", ["接口类型", "Interface"], "select", "openai-images", ["openai-images"]],
    ["imageBaseUrl", ["图像 API 地址", "Image API base URL"], "url", ""],
    ["imageModel", ["生成模型", "Generation model"], "text", ""],
    ["imageEditModel", ["编辑模型（留空沿用生成模型）", "Edit model (blank uses generation model)"], "text", ""],
    ["imageEditing", ["参考图与编辑能力", "Reference image and editing support"], "select", "false", ["true", "false"]],
    ["imageSize", ["图像尺寸", "Image size"], "text", "1024x1024"],
    ["imageOutputFormat", ["输出格式", "Output format"], "select", "provider-default", ["provider-default", "png", "jpeg", "webp"]],
    ["imageQuality", ["图像质量（留空使用服务默认）", "Quality (blank uses provider default)"], "text", ""],
    ["imageGenerationEndpoint", ["生成端点（可选）", "Generation endpoint (optional)"], "url", ""],
    ["imageEditEndpoint", ["编辑端点（可选）", "Edit endpoint (optional)"], "url", ""],
  ] as Array<[string, [string, string], Field["type"], string, string[]?]>).map(([key, label, type, value, options]): Field => ({key, label, type, default: value, options, group: "image"})),
  {key: "imageTimeout", group: "image", label: ["请求超时（秒）", "Request timeout (seconds)"], type: "number", default: "300", min: 10, max: 3600},
  {key: "imageConcurrency", group: "image", label: ["全局图像并发", "Global image concurrency"], type: "number", default: "2", min: 1, max: 4},
  {
    key: "searchProvider", group: "system", label: ["搜索服务", "Search provider"],
    type: "select", options: ["serper", "brave"], default: "serper",
  },
  {
    key: "providerName",
    group: "model",
    label: ["服务商名称", "Provider name"],
    type: "text",
    default: "Custom provider",
  },
  {
    key: "protocol",
    group: "model",
    label: ["API 协议", "API protocol"],
    type: "select",
    options: ["openai-completions", "openai-responses"],
    default: "openai-completions",
  },
  {
    key: "baseUrl",
    group: "model",
    label: ["API 地址", "API base URL"],
    type: "url",
    default: "",
    help: [
      "填写服务商提供的完整 API 基础地址（包括 /v1 等路径）。",
      "Use the complete provider base URL, including /v1 if required.",
    ],
  },
  {
    key: "modelId",
    group: "model",
    label: ["默认模型", "Default model ID"],
    type: "text",
    default: "",
  },
  {
    key: "contextWindow",
    group: "model",
    label: ["上下文窗口", "Context window"],
    type: "number",
    default: "131072",
    min: 1024,
    max: 10000000,
  },
  {
    key: "maxTokens",
    group: "model",
    label: ["最大输出 Token", "Maximum output tokens"],
    type: "number",
    default: "16384",
    min: 1,
    max: 1000000,
  },
  {
    key: "compaction",
    group: "system",
    label: ["自动压缩上下文", "Automatic compaction"],
    type: "select",
    options: ["true", "false"],
    default: "true",
  },
  {
    key: "retryAttempts",
    group: "system",
    label: ["模型重试次数", "Model retry attempts"],
    type: "number",
    default: "2",
    min: 0,
    max: 10,
  },
  {
    key: "language",
    group: "appearance",
    label: ["界面语言", "Interface language"],
    type: "select",
    options: ["zh", "en"],
    default: "zh",
  },
  {
    key: "theme",
    group: "appearance",
    label: ["外观", "Appearance"],
    type: "select",
    options: ["light", "dark", "system"],
    default: "light",
  },
];
export type Values = Record<string, string>;
export const defaults: Values = Object.fromEntries(
  fields.map((f) => [f.key, f.default]),
);
export interface ConfigSnapshot {
  revision: number;
  values: Values;
  apiKeyConfigured: boolean;
  imageApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  searchKeysConfigured: { serper: boolean; brave: boolean };
  dataDir: string;
  configFile: string;
  workspaceDir: string;
  configuredWorkspaceDir: string;
  workspaceRestartRequired: boolean;
  workspaceEnvironmentOverride: boolean;
}
export interface Project {
  directory?: string;
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export class InputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected a JSON object");
  return value as Record<string, unknown>;
}
export function validateValues(input: unknown): Values {
  const entries = record(input),
    result: Values = {};
  for (const [key, value] of Object.entries(entries)) {
    const field = fields.find((f) => f.key === key);
    if (!field) throw new InputError(`Unknown setting: ${key}`);
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\r\n\0]/u.test(value)
    )
      throw new InputError(`Invalid setting: ${key}`);
    const text = value.trim();
    if (field.options && !field.options.includes(text))
      throw new InputError(`Unsupported option: ${key}`);
    if (
      field.type === "number" &&
      (!/^\d+$/.test(text) ||
        !Number.isSafeInteger(Number(text)) ||
        Number(text) < field.min! ||
        Number(text) > field.max!)
    )
      throw new InputError(`Out of range: ${key} (${field.min}–${field.max})`);
    if (field.type === "url" && text) {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        throw new InputError("Invalid API URL");
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new InputError(
          "Use an HTTP(S) API URL without credentials, query or fragment",
        );
    }
    if (key === "providerName" && !text)
      throw new InputError("Provider name is required");
    result[key] = text;
  }
  return result;
}
export * from "./design.js";

export * from "./clarification.js";

export * from "./workflow.js";

export * from "./appearance.js";
export * from "./product-model.js";
