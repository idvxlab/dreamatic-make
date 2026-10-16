import { Worker } from "node:worker_threads";
import type { generateCAD } from "./cad.js";
export async function isolatedCAD(
  recipe: unknown,
  signal?: AbortSignal,
): Promise<ReturnType<typeof generateCAD>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cad-worker.js", import.meta.url), {
      workerData: recipe,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let finished = false;
    const finish = (error?: Error, value?: ReturnType<typeof generateCAD>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new Error("CAD generation cancelled"));
    const timer = setTimeout(
      () => finish(new Error("CAD generation exceeded 30 seconds")),
      30000,
    );
    worker.once("message", (result) =>
      result.ok
        ? finish(undefined, result.value)
        : finish(new Error(result.error)),
    );
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error("CAD worker stopped"));
    });
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
