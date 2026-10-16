import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decodeConfig } from "./env-config.js";
import { Store } from "./store.js";
import { createApp } from "./app.js";
import { DesignStore } from "./design-store.js";
import { AgentRuntime } from "./agents/runtime.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
let startupEnv: Record<string, string | undefined> = {};
let configuredWorkspace: string | undefined;
try {
  const text = await readFile(resolve(root, ".env"), "utf8");
  startupEnv = parseEnv(text);
  configuredWorkspace = decodeConfig(text).workspaceDir;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const dataDir = resolve(root, process.env.HARNESS_DATA_DIR || startupEnv.HARNESS_DATA_DIR || ".data");
const workspaceDir = resolve(root, process.env.WORKSPACE_DIR || configuredWorkspace || "workspace");
const port = Number(process.env.PORT || startupEnv.PORT || 4311);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535");
const store = new Store(dataDir, resolve(root, ".env"), workspaceDir);
await store.init();
const design = new DesignStore(store);
await design.recover();
const runtime = new AgentRuntime(design);
const server = createApp(store, resolve(root, "apps/web/dist"), {
  design,
  runtime,
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Dreamatic·Make: http://127.0.0.1:${port}\nData: ${dataDir}\nWorkspace: ${workspaceDir}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
    void runtime.shutdown();
  });
