---
name: make-appearance-review
description: "Coordinate graphical appearance review, targeted revisions, exact-version user approval and engineering handoff. Use at the concept approval gate and when design inputs change."
metadata:
  roles: "orchestrator, product, mechanical, validation"
---

# Visual Appearance Review

The sequence is requirements, provisional component envelopes, visual appearance concepts, explicit user approval, detailed hardware/structure/firmware, integration and documentation. Useful feasibility research may continue before approval. Do not start detailed CAD, fabrication artifacts, dependent firmware or final assembly documentation before approval.

Mechanical owns concept generation and editing; Product owns the design brief; Hardware supplies approximate envelopes and engineering constraints; Orchestrator organizes review; Validation flags obvious feasibility gaps without claiming physical testing. Keep seven roles.

Dispatch concept work with phase=concept and a bounded contract for the design rationale entry plus generated option IDs. Exact generated filenames are unknown until the tool saves outputs. Ask for three meaningfully different silhouettes/layouts by default with consistent presentation. Require use_skill(make-appearance-prompting), image_generate/image_edit, appearance_status and appearance_review. Use phase=research for preparatory research and phase=engineering for detailed deliverables. Never mislabel detailed work as research to bypass the gate.

Use appearance_status for current option IDs, versions, job states and the appearance.review record. Call appearance_review after images succeed; it pauses execution and displays graphical cards in conversation. Do not create duplicate text choice cards. Partial generation failure retains successful alternatives and the user's explicit retry controls.

Selection is not approval. Only the user-facing confirm action can record approval of a specific option revision. Agents cannot manufacture approval using context_update, free text, inferred preferences or a prior conversation. When resumed, reread appearance.review and the selected concept; preserve completed work and the confirmed version. Engineering outputs must depend on appearance.review and their exact requirements/hardware entries. A concept render is not dimensioned CAD or physical evidence.

Revision feedback and image references belong to the selected concept. Preserve features not requested to change. A new version of the selected direction invalidates old approval; changes to requirements/hardware inputs invalidate dependent concepts and approval through Context dependencies. Request an updated image and explicit confirmation again. Earlier user feedback and rejected directions remain available in version history; do not cycle back to rejected ideas without a reason.
