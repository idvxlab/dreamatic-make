import { type ProjectDesign, type RoleId } from "@harness/core";
export function overview(design: ProjectDesign, offset = 0, owner?: RoleId) {
  const context = design.context;
  const available = context.entries.filter(
    (entry) => !owner || entry.owner === owner,
  );
  return {
    totalEntries: available.length,
    nextOffset: available.length > offset + 60 ? offset + 60 : null,
    projectId: context.projectId,
    revision: context.revision,
    entries: available
      .slice(offset, offset + 60)
      .map(({ id, owner, title, revision, status, dependsOn }) => ({
        id,
        owner,
        title,
        revision,
        status,
        dependsOn,
      })),
    latestChanges: context.changes
      .slice(-12)
      .map((change) => ({
        revision: change.revision,
        actor: change.actor,
        entryId: change.entryId,
        reason: change.reason,
        invalidated: change.invalidated,
      })),
    artifacts: context.artifacts
      .slice(-40)
      .map(({ id, name, kind, owner }) => ({ id, name, kind, owner })),
  };
}
export function contextSlice(
  design: ProjectDesign,
  role: RoleId,
  ids?: string[],
  sinceRevision = 0,
) {
  const context = design.context;
  const selected = ids
    ? new Set(ids)
    : new Set(
        context.entries
          .filter((entry) => entry.owner === role || entry.owner === "product")
          .map((entry) => entry.id),
      );
  if (!ids) {
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const entry of context.entries)
        if (selected.has(entry.id))
          for (const dependency of entry.dependsOn)
            if (!selected.has(dependency)) {
              selected.add(dependency);
              expanded = true;
            }
    }
  }
  let size = 0;
  const entries = [],
    remainingIds = [];
  for (const id of selected) {
    const entry = context.entries.find((item) => item.id === id);
    if (!entry) continue;
    const bytes = JSON.stringify(entry).length;
    if (entries.length && size + bytes > 48000) {
      remainingIds.push(id);
      continue;
    }
    entries.push(entry);
    size += bytes;
  }
  return {
    revision: context.revision,
    entries,
    remainingIds,
    changes: context.changes
      .filter(
        (change) =>
          change.revision > sinceRevision &&
          (selected.has(change.entryId) ||
            change.invalidated.some((id) => selected.has(id))),
      )
      .slice(-20)
      .map((change) => ({
        revision: change.revision,
        entryId: change.entryId,
        reason: change.reason,
        invalidated: change.invalidated,
      })),
  };
}
