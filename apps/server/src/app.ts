import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fields, InputError, PI_VERSION } from "@harness/core";
import { createHarnessSession } from "@harness/core/pi";
import { Store } from "./store.js";
import { DesignStore } from "./design-store.js";
import { AgentRuntime } from "./agents/runtime.js";
import { designAPI } from "./design-api.js";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new InputError("Content-Type must be application/json", 415);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= 1048576) chunks.push(chunk);
  }
  if (bytes > 1048576) throw new InputError("Request body is too large", 413);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("Invalid JSON");
  }
}
export function createApp(
  store: Store,
  webDir?: string,
  options?: { design?: DesignStore; runtime?: AgentRuntime },
) {
  const design = options?.design ?? new DesignStore(store);
  const runtime = options?.runtime ?? new AgentRuntime(design);
  let diagnosing = false;
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      // Reject DNS rebinding and cross-site access to this unauthenticated local service.
      const host = req.headers.host;
      if (!host || !/^127\.0\.0\.1:\d+$/.test(host))
        throw new InputError("Loopback host required", 403);
      const origin = req.headers.origin;
      if (
        origin &&
        ![`http://${host}`, "http://127.0.0.1:5174"].includes(origin)
      )
        throw new InputError("Origin not allowed", 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new InputError("Cross-site access denied", 403);
      const url = new URL(req.url ?? "/", `http://${host}`),
        path = url.pathname,
        method = req.method;
      if (path === "/api/health" && method === "GET")
        return json(res, 200, {
          status: "ok",
          piVersion: PI_VERSION,
          agents: 7,
          product: "dreamatic-make",
        });
      if (path === "/api/config" && method === "GET")
        return json(res, 200, { ...(await store.config()), fields });
      if (path === "/api/config" && method === "PUT")
        return json(res, 200, {
          ...(await store.saveConfig(await body(req))),
          fields,
        });
      if (path === "/api/projects" && method === "GET")
        return json(res, 200, await store.projects());
      if (path === "/api/projects" && method === "POST")
        return json(res, 201, await store.createProject(await body(req)));
      const match = path.match(/^\/api\/projects\/([a-f0-9-]+)$/);
      if (match && method === "PATCH")
        return json(
          res,
          200,
          await design.exclusive(match[1], async () => store.updateProject(match[1], await body(req))),
        );
      if (match && method === "DELETE")
        return json(res, 200, await design.exclusive(match[1], async () => store.deleteProject(match[1], await body(req))));
      if (path === "/api/runtime/diagnose" && method === "POST") {
        await body(req);
        if (diagnosing)
          throw new InputError("A diagnostic is already running", 409);
        diagnosing = true;
        try {
          const config = await store.privateConfig();
          const { session } = await createHarnessSession({
            cwd: store.dataDir,
            agentDir: resolve(store.dataDir, "pi"),
            values: config.values,
            apiKey: config.apiKey,
            systemPrompt: "Harness SDK diagnostic. No model requests are made.",
          });
          try {
            return json(res, 200, {
              ok: true,
              piVersion: PI_VERSION,
              modelId: session.model?.id,
              activeTools: session.getActiveToolNames(),
              message:
                "SDK session initialized locally. Provider connectivity and credentials have not been tested.",
            });
          } finally {
            session.dispose();
          }
        } finally {
          diagnosing = false;
        }
      }
      if (
        await designAPI(
          req,
          res,
          url,
          design,
          runtime,
          () => body(req),
          (status, value) => json(res, status, value),
        )
      )
        return;
      if (path.startsWith("/api/"))
        throw new InputError("API endpoint not found", 404);
      if (!webDir || !["GET", "HEAD"].includes(method ?? ""))
        throw new InputError("Not found", 404);
      const root = resolve(webDir),
        file = resolve(root, "." + decodeURIComponent(path));
      if (file !== root && !file.startsWith(root + sep))
        throw new InputError("Not found", 404);
      let target = file;
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) {
        if (extname(path)) throw new InputError("Not found", 404);
        target = resolve(root, "index.html");
      }
      const contents = await readFile(target).catch(() => {
        throw new InputError("Web build missing. Run npm run build.", 503);
      });
      res.writeHead(200, {
        "Content-Type": types[extname(target)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      });
      res.end(method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (error instanceof InputError)
        json(res, error.status, { error: error.message });
      else {
        console.error(
          "Local service error:",
          error instanceof Error ? error.name : "Unknown",
        );
        json(res, 500, {
          error: "Local service error. Check data files and service logs.",
        });
      }
    }
  });
}
