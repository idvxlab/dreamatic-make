import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let stopping = false;
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env });
  children.add(child);
  child.on("exit", () => children.delete(child));
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const name of ["@harness/core", "@harness/server"]) {
  const child = launch(npm, ["run", "build", "-w", name]);
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0 || stopping) process.exit(code || 1);
}
// Launch watch processes directly so SIGTERM reaches each child, without npm shells.
const server = launch(
  process.execPath,
  ["--watch", "apps/server/dist/index.js"],
  { ...process.env, PORT: "4311" },
);
const compiler = launch(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "-p",
  "apps/server/tsconfig.json",
  "--watch",
  "--preserveWatchOutput",
]);
const coreCompiler = launch(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "-p",
  "packages/core/tsconfig.json",
  "--watch",
  "--preserveWatchOutput",
]);
const web = launch(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "apps/web",
  "--config",
  "apps/web/vite.config.ts",
  "--host",
  "127.0.0.1",
]);
for (const child of [server, compiler, coreCompiler, web])
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
