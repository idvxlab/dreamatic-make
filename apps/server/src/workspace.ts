import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import type { Project } from "@harness/core";

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function fingerprint(path: string): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error("Workspace migration does not follow symbolic links");
  if (info.isFile()) return createHash("sha256").update(await readFile(path)).digest("hex");
  if (!info.isDirectory()) throw new Error("Unsupported workspace file type");
  const entries = (await readdir(path)).sort();
  const hashes = [];
  for (const entry of entries) hashes.push([entry, await fingerprint(join(path, entry))]);
  return createHash("sha256").update(JSON.stringify(hashes)).digest("hex");
}

// Publish the index only after every project has a verified destination. Keeping
// legacy sources until publication makes an interrupted migration retryable.
export async function prepareWorkspace(dataDir: string, workspaceDir: string) {
  await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
  await access(workspaceDir, constants.R_OK | constants.W_OK | constants.X_OK);
  const workspaceRoot = await realpath(workspaceDir);
  const dataRoot = await realpath(dataDir);
  const legacyRoot = await realpath(join(dataDir, "design")).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return join(dataRoot, "design");
  });
  if (workspaceRoot === dataRoot || workspaceRoot === legacyRoot ||
      workspaceRoot.startsWith(legacyRoot + sep) || legacyRoot.startsWith(workspaceRoot + sep))
    throw new Error("Workspace must be separate from application data and legacy project directories");
}

export async function migrateWorkspace(dataDir: string, workspaceDir: string, directory: (project: Project) => string) {
  await prepareWorkspace(dataDir, workspaceDir);
  const index = join(workspaceDir, "projects.json");
  if (await exists(index)) return;
  const legacyIndex = join(dataDir, "projects.json");
  if (!await exists(legacyIndex)) return;
  const projects: Project[] = JSON.parse(await readFile(legacyIndex, "utf8"));
  const sources: string[] = [];
  for (const project of projects) {
    const destination = directory(project);
    const source = join(dataDir, "design", project.directory ?? project.id);
    if (await exists(source)) {
      const original = await fingerprint(source);
      if (!await exists(destination)) {
        const temporary = join(workspaceDir, `.migrating-${randomUUID()}`);
        try {
          await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
          if (await fingerprint(temporary) !== original) throw new Error("Workspace migration verification failed");
          await rename(temporary, destination);
        } finally { await rm(temporary, { recursive: true, force: true }); }
      } else if (await fingerprint(destination) !== original) {
        throw new Error("Workspace destination conflicts with legacy project files");
      }
      sources.push(source);
    } else if (!await exists(destination)) {
      await mkdir(destination, { mode: 0o700 });
    }
  }
  const temporaryIndex = join(workspaceDir, `.projects-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryIndex, JSON.stringify(projects, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporaryIndex, index);
  } finally { await rm(temporaryIndex, { force: true }); }
  for (const source of sources) await rm(source, { recursive: true, force: true });
  await rm(legacyIndex);
}
