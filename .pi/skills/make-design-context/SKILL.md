---
name: make-design-context
description: "Maintain shared Design Context entries, dependencies, handoffs, change impact, and conflict recovery in Dreamatic Make. Use for Context maintenance, not domain design or copying the whole project."
metadata:
  roles: "product, hardware, mechanical, firmware, validation, orchestrator, documentation"
---

# Design Context Maintenance

Organize entries around one maintainable fact or decision: a component, an interface, related requirements, a mechanical part, or a test. Save large source files as artifacts and reference their IDs.

## Valid Updates

1. Find stable IDs with `context_overview`. Use `context_read` for entries to change and dependencies actually used. Indexes and task summaries do not provide complete engineering parameters.
2. Preserve the entry's valid content and use its current baseRevision; use 0 for a new entry. `context_update` replaces one whole entry rather than merging fields. Specify reason, dependsOn, and artifactIds.
3. dataJson is a serialized JSON object. Record quantities, units, models, and unknowns explicitly. The ready status means available for review, not physically tested.
4. Source changes mark the dependency chain needs_review. Review inputs before revising the entry; do not merely clear its status. Regenerate files based on obsolete inputs or explicitly maintain a new applicable version.

On a version conflict, reread the entries identified by the error, compare changes, and submit a revision. Never overwrite new facts with stale content. Record cross-role changes as issues or proposals instead of editing another owner's entries.

Handoffs contain only the reason for change, entry/artifact IDs, affected objects, and unresolved matters. Historical receipts are not loaded knowledge, and chat summaries are not a second BOM.
