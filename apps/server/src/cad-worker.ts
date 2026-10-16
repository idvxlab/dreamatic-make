import { parentPort, workerData } from "node:worker_threads";
import { generateCAD } from "./cad.js";
try {
  parentPort?.postMessage({ ok: true, value: generateCAD(workerData) });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "CAD generation failed",
  });
}
