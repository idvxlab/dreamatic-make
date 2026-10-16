import { parseEnv } from "node:util";
import { defaults, validateValues } from "@harness/core";
import type { Values } from "@harness/core";

export interface StoredConfig {
  revision: number;
  values: Values;
  apiKey: string;
  imageApiKey?: string;
  searchApiKey?: string;
  serperApiKey?: string;
  workspaceDir?: string;
}
const settings: Record<string, string> = {
  providerName: "MAKE_PROVIDER_NAME",
  searchProvider: "MAKE_SEARCH_PROVIDER",
  protocol: "MAKE_API_PROTOCOL",
  baseUrl: "MAKE_API_BASE_URL",
  modelId: "MAKE_MODEL_ID",
  contextWindow: "MAKE_CONTEXT_WINDOW",
  maxTokens: "MAKE_MAX_TOKENS",
  compaction: "MAKE_COMPACTION",
  retryAttempts: "MAKE_RETRY_ATTEMPTS",
  language: "MAKE_LANGUAGE",
  theme: "MAKE_THEME",
  imageProtocol: "MAKE_IMAGE_PROTOCOL",
  imageBaseUrl: "MAKE_IMAGE_BASE_URL",
  imageModel: "MAKE_IMAGE_MODEL",
  imageEditModel: "MAKE_IMAGE_EDIT_MODEL",
  imageEditing: "MAKE_IMAGE_EDITING",
  imageSize: "MAKE_IMAGE_SIZE",
  imageOutputFormat: "MAKE_IMAGE_OUTPUT_FORMAT",
  imageQuality: "MAKE_IMAGE_QUALITY",
  imageGenerationEndpoint: "MAKE_IMAGE_GENERATION_ENDPOINT",
  imageEditEndpoint: "MAKE_IMAGE_EDIT_ENDPOINT",
  imageTimeout: "MAKE_IMAGE_TIMEOUT",
  imageConcurrency: "MAKE_IMAGE_CONCURRENCY",

};
const managed = new Set([
  ...Object.values(settings), "MAKE_CONFIG_REVISION", "MAKE_IMAGE_API_KEY", "MAKE_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY", "WORKSPACE_DIR",
]);
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export function decodeConfig(text: string): StoredConfig {
  const env = parseEnv(text);
  // Our writer uses single-line JSON strings to preserve quotes, hashes and backslashes.
  // Unquoted and standard dotenv assignments remain supported for manual editing.
  const assignments = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = assignment.exec(line);
    if (!match || !managed.has(match[1]!)) continue;
    assignments.set(match[1]!, line.slice(line.indexOf("=") + 1).trim());
  }
  for (const [key, raw] of assignments) {
    if (raw.startsWith('"')) {
      try {
        const value: unknown = JSON.parse(raw);
        if (typeof value === "string") env[key] = value;
      } catch { /* Standard dotenv syntax, including trailing comments. */ }
    }
  }
  const values = { ...defaults };
  for (const [key, name] of Object.entries(settings)) {
    if (env[name] !== undefined) values[key] = env[name]!;
  }
  validateValues(values);
  if (Number(values.maxTokens) > Number(values.contextWindow))
    throw new Error("Maximum output tokens cannot exceed context window");
  const revision = Number(env.MAKE_CONFIG_REVISION ?? "0");
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("Invalid MAKE_CONFIG_REVISION");
  for (const name of ["MAKE_IMAGE_API_KEY", "MAKE_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY"]) {
    const value = env[name] ?? "";
    if (value.length > 8192 || /[\r\n\0]/u.test(value))
      throw new Error(`Invalid ${name}`);
  }
  if (env.WORKSPACE_DIR !== undefined && (!env.WORKSPACE_DIR.trim() || env.WORKSPACE_DIR.length > 4096 || /[\r\n\0]/u.test(env.WORKSPACE_DIR)))
    throw new Error("Invalid WORKSPACE_DIR");
  return { imageApiKey: env.MAKE_IMAGE_API_KEY ?? "", serperApiKey: env.SERPER_API_KEY ?? "", workspaceDir: env.WORKSPACE_DIR, revision, values, apiKey: env.MAKE_API_KEY ?? "", searchApiKey: env.BRAVE_SEARCH_API_KEY ?? "" };
}

export function encodeConfig(config: StoredConfig, previous = ""): string {
  const values: Record<string, string> = {
    MAKE_CONFIG_REVISION: String(config.revision),
    ...Object.fromEntries(Object.entries(settings).map(([key, name]) => [name, config.values[key] ?? defaults[key]!])),
    MAKE_API_KEY: config.apiKey,
    MAKE_IMAGE_API_KEY: config.imageApiKey ?? "",
    BRAVE_SEARCH_API_KEY: config.searchApiKey ?? "",
    SERPER_API_KEY: config.serperApiKey ?? "",
  };
  const workspace = config.workspaceDir ?? (previous ? decodeConfig(previous).workspaceDir : undefined);
  if (workspace !== undefined) values.WORKSPACE_DIR = workspace;
  const written = new Set<string>();
  const lines = previous ? previous.trimEnd().split(/\r?\n/u) : ["# Dreamatic·Make system configuration. Keep this file private."];
  const output: string[] = [];
  for (const line of lines) {
    const key = assignment.exec(line)?.[1];
    if (key && managed.has(key)) {
      if (!written.has(key)) output.push(`${key}=${JSON.stringify(values[key])}`);
      written.add(key);
    } else output.push(line);
  }
  for (const [key, value] of Object.entries(values)) {
    if (!written.has(key)) output.push(`${key}=${JSON.stringify(value)}`);
  }
  return output.join("\n") + "\n";
}
