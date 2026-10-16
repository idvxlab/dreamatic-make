# Agent Markdown and Project Skills

Make follows Dreamatic's `.pi/agents/` and `.pi/skills/` layout. Make maintains its own domain knowledge without importing the Art runtime or installing resources into user-global directories. Write all documentation and instructions in English.

## Seven Agents

| File | Responsibilities |
| --- | --- |
| `.pi/agents/product.md` | Product definition |
| `.pi/agents/hardware.md` | Open-source hardware, components, and sourcing |
| `.pi/agents/mechanical.md` | Product form, mechanical design, and CAD |
| `.pi/agents/firmware.md` | Firmware and interaction |
| `.pi/agents/validation.md` | Integration and validation |
| `.pi/agents/orchestrator.md` | Orchestration and project coordination |
| `.pi/agents/documentation.md` | Tutorials and technical documentation |

Each file has YAML frontmatter containing `name`, `description`, and a `role` matching its code-level role ID. Its body defines responsibilities, inputs, outputs, and handoffs.

Maintain shared Context ownership, revision, dependency, evidence, and knowledge-loading rules in `.pi/APPEND_SYSTEM.md`. Avoid separate conflicting versions of shared rules in the seven role files.

`apps/server/src/agents/definitions.ts` locates files, uses Pi Markdown/Skill parsers, validates resources, discovers role knowledge, and assembles prompts. It does not embed a second set of seven role instructions. TypeScript still controls role IDs, tool permissions, and lifecycle; changing Markdown grants no new tools or execution rights.

## Ten Project Skills

| Skill | Purpose | Roles |
| --- | --- | --- |
| `make-design-context` | Entry maintenance, targeted handoffs, conflicts, change propagation | All |
| `make-product-definition` | Physical prototype requirements and acceptance | Product, Orchestrator |
| `make-hardware-sourcing` | Specifications, interfaces, BOM, procurement evidence | Hardware, Validation |
| `make-industrial-form` | Appearance, ergonomics, form constraints | Mechanical, Product |
| `make-parametric-cad` | Parametric CSG, separate parts, model artifacts | Mechanical |
| `make-fdm-print-design` | Print orientation, joints, tolerance, test coupons | Mechanical, Validation |
| `make-firmware-interaction` | Drivers, interaction, source delivery | Firmware |
| `make-prototype-validation` | Check matrices, issues, retests | Validation |
| `make-technical-documentation` | Assembly, wiring, flashing, troubleshooting | Documentation |
| `make-project-coordination` | Task allocation, recovery, delivery | Orchestrator |

Skills provide methods rather than new CAD, slicing, compilation, flashing, or web-fetching capabilities. Actual tools and evidence determine what a task can accomplish.

`make-parametric-cad/references/csg-recipes.md` documents the current geometry recipe, constraints, and examples. Read it only when needed.

## Loading

1. At the beginning of a new run, load a snapshot of the seven Agents, shared rules, and Skill bodies from the application's own `.pi`. Do not scan the task cwd, `~/.pi`, or `../Dreamatic`.
2. Each role prompt contains its own instructions, shared rules, team roster, and applicable Skills' names, descriptions, relative paths, and hashes. It does not contain every Skill body.
3. The model filters through `list_skills({query?})` and loads individual bodies using `use_skill({name,rationale})`.
4. After loading, `read_skill_reference({name,path})` reads supporting `references/*.md` within that Skill. Absolute paths, `..`, and symlinks escaping the directory are rejected. Scripts are not executed.
5. Each task records the Agent path, Agent and final-prompt SHA-256 hashes, and loaded Skill/reference hashes and rationales. Expand role/knowledge versions in task details to inspect them; the ZIP task index includes these receipts.

Agent/Skill changes take effect on the **next new run**, without recompilation or restart. Active runs retain their body snapshot. Reference files are read at request time and their current hashes recorded. A later role task, new session, or context compaction does not make historical receipts proof that instructions are still loaded; reload as needed.

## Adding or Updating a Skill

For example, add a battery-selection Skill:

```text
.pi/skills/make-battery-selection/
├── SKILL.md
└── references/       # Create only when detailed supporting resources are needed
```

```yaml
---
name: make-battery-selection
description: "Check power requirements, interfaces, and selection evidence for battery-powered prototypes. Use to compare battery and power-module options."
metadata:
  roles: "hardware, validation"
---
```

Write professional judgment and handoff requirements in the body. Put optional detailed resources in references, link them relatively, and explain when to read them. The directory must match name, using lowercase letters, digits, and hyphens, up to 64 characters. metadata.roles accepts a comma-separated string or role array; omission makes the Skill discoverable to all roles. Prefer a relevant role scope.

New directories are discovered automatically; no TypeScript Skill-name list needs updating. Arbitrary Skill script execution and references outside the Skill directory are intentionally unsupported. New engineering capabilities require a dedicated tool adapter and tests before updating corresponding knowledge.

An eighth Agent requires changes to core ROLES, tool routing, and UI. A new Skill extends existing roles' knowledge instead.

Deploy the project-root `.pi/` directory. Missing or invalid Agent files prevent runs from starting; there is no fallback to old embedded prompts. Copying only `apps/server/dist/` is insufficient.

## Validation

```bash
npm run check:knowledge
npm run check
npm test
npm run build
```

check:knowledge uses Pi Markdown/Skill parsers to validate the seven Agents, shared rules, and discovered Skills. Build and test commands also invoke it. Tests cover on-demand loading, role filtering, body edits, snapshot stability, reference isolation, and task receipts. A local mock OpenAI streaming endpoint also verifies real Pi calls to use_skill.
