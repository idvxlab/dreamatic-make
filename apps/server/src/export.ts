import { ZipFile } from "yazl";
import { createHash } from "node:crypto";
import { InputError } from "@harness/core";
import type { DesignStore } from "./design-store.js";

export async function projectZip(designStore: DesignStore, projectId: string) {
  const project = (await designStore.store.projects()).find(
    (item) => item.id === projectId,
  );
  if (!project) throw new InputError("Project not found", 404);
  const design = await designStore.read(projectId);
  // Copy exactly the metadata snapshot above. Later writes cannot change this export.
  const files: Array<{ path: string; content: Buffer }> = [];
  const referenced = new Set(
    design.context.entries.flatMap((entry) => entry.artifactIds),
  );
  const current = new Map<string, { id: string; hash: string }>();
  let total = 0;
  for (const artifact of design.context.artifacts) {
    total += artifact.bytes;
    if (total > 128 * 1024 * 1024)
      throw new InputError("Export exceeds 128 MiB");
    const { content } = await designStore.artifactContent(
      projectId,
      artifact.id,
    );
    if (createHash("sha256").update(content).digest("hex") !== artifact.sha256)
      throw new InputError(
        `Artifact integrity check failed: ${artifact.name}`,
        409,
      );
    files.push({
      path: `artifacts/${artifact.owner}/${artifact.id}/${artifact.name}`,
      content,
    });
    if (referenced.has(artifact.id)) {
      const path = `current/${artifact.owner}/${artifact.name}`,
        previous = current.get(path);
      if (previous && previous.hash !== artifact.sha256)
        throw new InputError(
          `Multiple currently referenced versions use ${path}; update Context artifactIds to select one version.`,
          409,
        );
      if (!previous) {
        current.set(path, { id: artifact.id, hash: artifact.sha256 });
        files.push({ path, content });
      }
    }
  }
  const zip = new ZipFile();
  const index = design.context.artifacts.map((artifact) => ({
    ...artifact,
    path: `artifacts/${artifact.owner}/${artifact.id}/${artifact.name}`,
    currentPath: referenced.has(artifact.id)
      ? `current/${artifact.owner}/${artifact.name}`
      : undefined,
  }));
  const add = (path: string, value: unknown) =>
    zip.addBuffer(Buffer.from(JSON.stringify(value, null, 2) + "\n"), path);
  add("project.json", project);
  add("design-context.json", design.context);
  add("artifact-manifest.json", {
    exportedAt: new Date().toISOString(),
    contextRevision: design.context.revision,
    artifacts: index,
  });
  add(
    "tasks.json",
    design.runs.map(({ events, ...run }) => run),
  );
  zip.addBuffer(
    Buffer.from(
      "# Dreamatic Make prototype package\n\nThis is a project snapshot, not a manufacturing or safety certification.\n\nStart with design-context.json and artifact-manifest.json. current/ reconstructs files referenced by current Context, grouped by role, preserving relative source paths. It may include draft or needs_review work; check Context before building. Artifacts are immutable and grouped by role and ID; choose versions referenced by current Context entries. Entries marked needs_review require inspection. Source files, models, instructions and actual evidence may have different validation states. Printing, compilation, flashing and physical tests must be checked explicitly.\n\nAPI keys, application settings, Pi sessions and private caches are excluded.\n",
    ),
    "README.md",
  );
  for (const file of files) zip.addBuffer(file.content, file.path);
  // The consumer attaches stream/error handlers before starting the archive.
  return { zip, filename: `dreamatic-make-${projectId}.zip` };
}
