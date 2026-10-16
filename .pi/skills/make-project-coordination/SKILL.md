---
name: make-project-coordination
description: "Coordinate tasks, dependencies, tradeoffs, recovery, and delivery across the seven Make roles. Use for orchestration and local changes; not every request requires every role."
metadata:
  roles: "orchestrator"
---

# Prototype Project Coordination

Accept all user requests through the orchestrator. Infer the appropriate role from the requested outcome, existing entry ownership, and dependencies. Route requirements to Product, component choices to Hardware, form/CAD to Mechanical, device behavior to Firmware, evidence and faults to Validation, and build instructions to Documentation. Combine roles only when their inputs or outputs require it. Users should never need to select a role or carry handoffs themselves.

Choose the next step from the user task and current Context rather than restarting a fixed role pipeline. For a new product, define requirements, explore hardware and form, then arrange mechanical/firmware work, integration, and documentation as needed. Existing projects need only affected scopes.

If a specialist returns needsInput, stop orchestration and wait for the saved question card to be answered. Never dispatch the next specialist after a blocking question.

Each delegate_task supplies a structured contract with objective, editableEntryIds, expectedEntryIds, expectedArtifactNames, acceptanceCriteria, and dependsOnTaskIds, alongside targeted contextIds. Include at least one expected entry or artifact. Retry an unsuccessful task using retryOf; do not dispatch dependents until their prerequisite tasks complete. Specialists save their own artifacts; returned summaries provide navigation. Make component and interface dependencies explicit so hardware and mechanical roles do not invent separate dimensions.

Product owns requirements, Hardware owns BOM, Mechanical owns CAD, Firmware owns sources, Validation owns checks, and Documentation owns tutorials. The orchestrator maintains only plans, cross-role decisions, issues, and the artifact index.

When missing user requirements block selection, call ask_user before generating purchasing or mechanical plans that assume confirmation. A simple bracket needs no firmware; a project without electronics needs no hardware selection. Actual work determines which roles participate.

When resuming interrupted work, inspect saved tasks and input versions and preserve successful artifacts. Tool errors are task feedback; do not repeat identical calls without changes. Save valid progress, remaining tasks, and blockers throughout execution so interruption never requires restarting completed work.

Before delivery, read validation conclusions and the file index and check that their version chain agrees. If physical tests remain pending, describe the delivery as a package awaiting fabrication and testing; do not declare product acceptance complete.

Visual appearance review is mandatory before detailed engineering. Load make-appearance-review. delegate_task includes phase=research, concept or engineering. Concept work is owned by Mechanical and uses generated images, not text choices. The graphical review card records exact-version user approval; never simulate it. After confirmation, use appearance.review as an explicit dependency of engineering entries.
