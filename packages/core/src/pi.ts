import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateModelRuntimeOptions,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { defaults, InputError, validateValues, type Values } from "./index.js";

export interface HarnessSessionOptions {
  cwd: string;
  agentDir: string;
  values: Values;
  apiKey: string;
  /** Callers explicitly supply instructions and allowed tools; project knowledge is loaded by the application runtime. */
  systemPrompt: string;
  tools?: ToolDefinition[];
  /** Omit for an isolated, non-persistent diagnostic session. */
  sessionManager?: SessionManager;
}
/** SDK-only boundary: no auto-discovered agents, skills, extensions, MCP or shell tools. */
export async function createHarnessSession(options: HarnessSessionOptions) {
  const values = { ...defaults, ...validateValues(options.values) };
  if (!values.baseUrl || !values.modelId || !options.systemPrompt.trim())
    throw new InputError(
      "Model URL, model ID and explicit system prompt are required",
    );
  if (Number(values.maxTokens) > Number(values.contextWindow))
    throw new InputError("Maximum output tokens cannot exceed context window");
  await mkdir(options.agentDir, { recursive: true, mode: 0o700 });
  type Credentials = NonNullable<CreateModelRuntimeOptions["credentials"]>;
  type Credential = Exclude<
    Awaited<ReturnType<Credentials["read"]>>,
    undefined
  >;
  const memory = new Map<string, Credential>();
  const credentials: Credentials = {
    read: async (id) => memory.get(id),
    list: async () =>
      [...memory].map(([provider, credential]) => ({
        providerId: provider,
        type: credential.type,
      })),
    modify: async (id, fn) => {
      const next = await fn(memory.get(id));
      if (next) memory.set(id, next);
      else memory.delete(id);
      return next;
    },
    delete: async (id) => {
      memory.delete(id);
    },
  };
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStorePath: join(options.agentDir, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("harness-custom", {
    name: values.providerName,
    baseUrl: values.baseUrl,
    api: values.protocol as "openai-completions" | "openai-responses",
    models: [
      {
        id: values.modelId,
        name: values.modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: Number(values.contextWindow),
        maxTokens: Number(values.maxTokens),
      },
    ],
  });
  if (options.apiKey)
    await modelRuntime.setRuntimeApiKey("harness-custom", options.apiKey);
  const model = modelRuntime.getModel("harness-custom", values.modelId);
  if (!model) throw new Error("Configured model could not be registered");
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => options.systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  return createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    resourceLoader,
    tools: (options.tools ?? []).map((tool) => tool.name),
    customTools: options.tools ?? [],
    sessionManager:
      options.sessionManager ?? SessionManager.inMemory(options.cwd),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: values.compaction === "true" },
      retry: {
        enabled: Number(values.retryAttempts) > 0,
        maxRetries: Number(values.retryAttempts),
      },
    }),
  });
}
