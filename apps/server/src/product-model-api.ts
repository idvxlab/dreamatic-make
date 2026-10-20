import type { IncomingMessage, ServerResponse } from "node:http";
import { InputError, record } from "@harness/core";
import { ProductModelService } from "./product-model.js";

export async function productModelAPI(req: IncomingMessage, res: ServerResponse, url: URL, service: ProductModelService,
  readBody: () => Promise<unknown>, json: (status: number, body: unknown) => void): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)\/model(?:\/(import|simulate|demo))?$/);
  if (!match) return false;
  const [, id, action] = match;
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", abort);
  try {
    if (!action && req.method === "GET") json(200, await service.load(id, controller.signal));
    else if (action && req.method === "POST") {
      const body = await readBody();
      const value = action === "demo" ? await service.demo(id, String(record(body).name), controller.signal)
        : action === "import" ? await service.import(id, body, controller.signal)
        : await service.simulate(id, body, controller.signal);
      json(200, value);
    } else throw new InputError("Method not allowed", 405);
  } finally { res.removeListener("close", abort); }
  return true;
}
