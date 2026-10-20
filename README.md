# Dreamatic·Make

A local multi-agent workbench for **physical device prototypes built with 3D printing, open-source hardware, and off-the-shelf components**. It uses the pinned Pi **1.3.0** SDK. Seven roles share one Design Context through targeted reads, local updates, and concise handoffs.

## Getting Started

Requires Node.js **22.19+** and npm. Run commands from the repository root.

### First Launch

```bash
cd /path/to/dreamatic-make
npm ci --ignore-scripts
npm run build
npm start
```

Open [http://127.0.0.1:4311](http://127.0.0.1:4311). Keep the terminal open while using the application. Configure the model through **Dreamatic·Make → Settings**, or edit the root `.env` as described below.

### Start and Stop Manually

Once dependencies and build output exist:

```bash
cd /path/to/dreamatic-make
npm start
```

Press **Ctrl+C** in that terminal to stop the server. After changing application code, run `npm run build` before starting again. `npm start` serves the existing build and does not rebuild it.

### Development

```bash
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). The development command builds the backend, watches TypeScript, restarts the server, and enables frontend hot updates. Its backend and frontend proxy use port **4311**; the frontend uses **5174**. Stop any production server on 4311 before starting development. Press **Ctrl+C** to stop the development processes.

### Verification

```bash
npm run check:knowledge
npm run check
npm test
npm run build
```

Tests do not call paid models. A local mock OpenAI streaming endpoint drives the real Pi SDK through CAD and Context tools; a deterministic offline driver also verifies seven-role collaboration. Configuration tests cover `.env` persistence, legacy migration, special-character handling, and secret redaction.

## System Configuration

The single system configuration file is **`.env` in the repository root**. The settings dialog reads and writes that same file and displays its location under **Local storage**. WORKSPACE_DIR controls project files; HARNESS_DATA_DIR controls application data. Neither changes the location of this configuration file.

Startup creates `.env` if it is missing. For manual setup, copy [.env.example](.env.example) to `.env` **only if you do not already have a configuration file**, then edit the values. Model configuration is required before running agents; a key is optional for local services that do not require authentication.

| Variable | Purpose | Default |
| --- | --- | --- |
| `MAKE_PROVIDER_NAME` | Provider display name | `Custom provider` |
| `MAKE_API_PROTOCOL` | `openai-completions` or `openai-responses` | `openai-completions` |
| `MAKE_API_BASE_URL` | Complete provider base URL, including `/v1` when required | Empty |
| `MAKE_MODEL_ID` | Model identifier | Empty |
| `MAKE_API_KEY` | Model provider API key | Empty |
| `MAKE_CONTEXT_WINDOW` | Model context capacity in tokens | `131072` |
| `MAKE_MAX_TOKENS` | Maximum output tokens | `16384` |
| `MAKE_COMPACTION` | Automatic context compaction | `true` |
| `MAKE_RETRY_ATTEMPTS` | Model retry attempts | `2` |
| `MAKE_LANGUAGE` | UI language: `zh` or `en` | `zh` |
| `MAKE_THEME` | UI appearance: `light`, `dark`, or `system` | `light` |
| `MAKE_SEARCH_PROVIDER` | `serper` (default) or `brave` | `serper` |
| `SERPER_API_KEY` | Serper API key | Empty |
| `BRAVE_SEARCH_API_KEY` | Brave Search API key | Empty |
| `MAKE_CONFIG_REVISION` | Revision maintained by the settings UI | `0` |
| `PORT` | Production server port; requires restart | `4311` |
| `HARNESS_DATA_DIR` | Application data directory; requires restart | `.data` |
| `WORKSPACE_DIR` | Project workspace directory; requires restart | `workspace` |

Settings writes are atomic and preserve unrelated variables and comments. Values written by the UI use single-line JSON-quoted strings to preserve special characters; ordinary dotenv assignments are also accepted. Reload settings after manual edits and avoid simultaneous manual/UI writes. Process environment variables override `PORT`, `HARNESS_DATA_DIR`, and `WORKSPACE_DIR`; model settings are read directly from the file. Each provider may use its own SERPER_API_KEY or BRAVE_SEARCH_API_KEY process environment fallback when its saved key is empty.

When `.env` is absent, startup migrates legacy `config.json` from the selected data directory and removes it only after successfully saving the new file. An existing `.env` takes precedence.

`.env` is ignored by Git and application-created files use mode `0600`. It contains plaintext credentials, so keep it private. [.env.example](.env.example) contains placeholders and can be committed.

## Workflow

1. Open the **Dreamatic·Make** dropdown at the upper left, select **Settings**, and configure the endpoint, protocol, model ID, and API key. Chat Completions and Responses compatible endpoints are supported. Local services that require no key may leave it blank.
2. For web search, select **Serper** (default) or **Brave Search** under **System → Component research**, then enter that provider’s API key. Keys are stored independently; switching providers never reuses another provider’s key. Known public pages remain accessible without a search key.
3. Create a project and save initial requirements, equipment, budget, and constraints under **Project Notes**.
4. Submit a task under **Collaboration**. Every request goes to the orchestrator, which infers the required specialists and delegates automatically. Users do not select or switch agents. Calls use the configured model service and may incur provider charges.
5. Inspect or edit facts, owners, dependencies, revisions, and review status in **Design Context**.
6. Inspect structured purchasing records in **Hardware & BOM**, rotate STL files in **3D Models**, and read or download CAD, firmware, references, and tutorials in **Artifacts**.
7. Upload fit-test photographs, logs, or measurements in **Change History**, describing test conditions. These are user-reported observations; the system does not automatically establish a physical test pass.
8. Download a ZIP package. `current/` reconstructs each role's currently referenced files, preserving relative paths such as `src/main.cpp`; `artifacts/` preserves immutable versions. Exports exclude model configuration, API keys, Pi sessions, and caches, and include a SHA-256 artifact index and complete Context history.

When a provider returns an output-length cutoff, the runtime continues in the same persistent session, preserving earlier tool results instead of restarting the specialist. Continuation requests emphasize small saved steps. Three consecutive length cutoffs without a completed tool call produce a diagnostic rather than unlimited retries; check the provider’s reasoning/output budget in that case.

Runs can be stopped. After a server restart, unfinished runs become interrupted. Resume starts a new session from saved Context, artifacts, and prior task records without replaying old requests. Tasks awaiting input display their saved questions in the task card. Question cards support single choice, multiple choices, and free text. Choose the relevant options or write your own answer, then choose **Confirm & continue**. Answers are saved with the continuation run and sent to the orchestrator together with the original task and previous work. Existing questions without structured options still support free-text answers. Unanswered cards remain available when a run is stopped, interrupted, or failed. Specialists and the orchestrator pause after saving blocking questions. The shared ask_user tool saves a batch of structured questions; request_input remains available for a single question. A bounded recovery converts explicit waiting-for-confirmation headings into saved questions if a model omits the tool call.

Conversation output presents the coordinator result and unanswered questions directly, with compact spacing and a quiet status/activity link. There are no nested execution accordions in the conversation. View activity toggles a compact, muted inline activity log below the message. The log scrolls within a bounded height and follows new events while the user is near its bottom. Click Hide activity to close it. Intermediate specialist text remains in that log rather than being repeated in the main conversation.

The collaboration view places chronological messages and activity in a scrollable area above a fixed composer. New content follows automatically while you are near the bottom. Scrolling up pauses following; **Jump to latest** returns to the newest message. Press Enter to send or Shift+Enter for a new line (IME composition is preserved).

## Managing Projects

Each project in the left sidebar has Rename and Delete buttons. Rename updates the project name and moves its directory on disk; stable project, Context, artifact, and task IDs remain unchanged. New project directories use a sanitized name followed by the full project UUID. Existing UUID-only directories remain readable and move to the named layout when renamed.

Delete requires confirmation and permanently removes the project directory, including Context history, artifacts, and Pi sessions, along with its list record. Other projects and the root `.env` remain intact. Renaming and deletion reject stale metadata and are blocked while the project has a queued or running agent task; stop the run first.

## Offline Demo Without Model Credentials

```bash
npm run demo
```

Open **http://127.0.0.1:4312**. Each launch uses a new temporary data directory separate from the normal workspace. The demo includes a genuinely generated CSG enclosure/STL, placeholder components, Context, and draft instructions. It explicitly records that **no AI, purchasing, printing, or physical testing occurred**. The demo uses its own temporary `.env` and does not load the root model configuration. Press **Ctrl+C** to stop it. The temporary directory remains after exit; its location appears in the console.

## Seven Roles

| Role | Responsibilities |
| --- | --- |
| Product | Requirements, functions, scenarios, form direction, and acceptance criteria |
| Hardware & Components | Selection, interfaces, dimensions, BOM, procurement sources, and cost |
| 3D CAD & Mechanical | Product form, layout, separate parts, structure, parametric CAD, and printable models |
| Firmware & Interaction | Firmware, interaction logic, dependencies, build and flashing instructions |
| Integration & Validation | Compatibility, assembly, evidence, issues, and retesting |
| Orchestrator | Task allocation, dependencies, decisions, pending work, and handoffs |
| Documentation | Assembly, wiring, flashing, troubleshooting, and delivery instructions |

Roles have explicit boundaries: Product owns requirements and acceptance, Hardware owns verified components and the canonical BOM, Mechanical develops form/layout/parts in separate increments, Firmware implements confirmed interfaces, Validation independently reviews evidence, Documentation explains existing engineering facts, and Orchestrator coordinates rather than replacing specialists.

Delegations carry a task contract: objective, editable entry IDs, expected entry IDs/artifact filenames, acceptance criteria, and prerequisite task IDs. Runtime checks output existence, entry readiness, and editable scope. Professional correctness and physical testing still require explicit validation evidence. Missing outputs or unresolved specialist failures produce partial completion; a saved plan alone cannot conceal failed engineering work. Explicit retries link to the unsuccessful task with retryOf. Recoveries inherit user answers along the entire continuation chain. Outstanding questions remain available beyond the recent conversation window.

All roles run through explicit Pi SDK tools. They do not load other projects' AGENTS.md files, Skills, extensions, MCP servers, or default shell tools. They share the configured text model by default.

## Agent Markdown and Project Skills

Separate instructions live in `.pi/agents/{product,hardware,mechanical,firmware,validation,orchestrator,documentation}.md`. Shared rules live in `.pi/APPEND_SYSTEM.md`.

`.pi/skills/` provides ten knowledge packages: Context maintenance, product definition, hardware sourcing, industrial form, parametric CAD, FDM print design, firmware interaction, prototype validation, technical documentation, and project coordination. Roles load them on demand through `list_skills`, `use_skill`, and `read_skill_reference`. Actual versions are recorded without sending every Skill body by default.

Edits take effect on the next new run without rebuilding. Deployments must include `.pi/`; active runs retain their instruction snapshot. Run `npm run check:knowledge` to validate resources; build and test commands also perform this check.

Repository documentation, Agent/Skill instructions, and generated technical-document templates use English. UI localization and conversational replies are independent.

See [file locations, authoring conventions, and extension guidance](docs/AGENTS-AND-SKILLS.md).

## Design Context Maintenance

- Stable entry IDs, role ownership, single-entry replacement, revisions, and change reasons.
- Specialists edit only their own entries. Users may edit any entry through the UI while retaining its existing owner.
- Writes validate read versions. Dependencies must exist and have been read; dependency cycles and missing artifact references are rejected.
- Source changes transitively mark dependent entries `needs_review`, increment their revisions, and flag affected tasks. The system does not rerun the entire project.
- Tasks receive paginated indexes, relevant entries, and change summaries. Large sources, reference text, and meshes are read on demand by artifact ID.
- Every atomic write records before/after values. Context, tasks, and the artifact index share one project transaction file. Artifact contents cannot be overwritten.

`ready` means available for review or use, not physically validated. A completed run means agent execution ended, not that a manufactured product passed acceptance.

## Current Capabilities and Limits

| Capability | Current behavior |
| --- | --- |
| Multi-role execution | Real Pi execution; no fixed run duration, model-turn, tool-call, or delegation cutoff; specialists cannot recursively delegate; repeated identical tool failures still stop the run |
| CAD | Restricted declarative CSG: boxes, cylinders, translations/rotations, unions/differences/intersections, and parameter references; produces JSON recipes, OpenSCAD sources, real STL meshes, and geometry reports |
| CAD inspection | Isolated Worker checks geometry, volume, and bounds with a 30-second timeout and 256 MB heap limit; does not validate assembly, tolerance, strength, or printing |
| Search and web references | Serper/Brave Search and public HTTP(S) HTML/JSON/text extraction with source and retrieval time; blocks local/private destinations and redirects; does not bypass login or anti-bot controls |
| Firmware | Saves sources, configuration, build/flashing instructions, and test programs; does not execute arbitrary generated code, compile automatically, flash, or connect to devices |
| Evidence | Saves user files and observations. The text model cannot interpret binary photos/PDFs; the presence of files does not establish passing tests |
| Files | Immutable artifacts, downloads, interactive STL preview, text viewing, ZIP snapshots, and hash checks |

STEP/B-rep, complex surfaces, slicer/3MF projects, G-code, automatic physical testing, and supplier ordering require future dedicated adapters. Agents must state missing capabilities and cannot claim they ran. Prototype quality depends on the model, requirements, and source evidence; iterate with physical fit tests.

## Project Workspace and Application Data

Project files live under `workspace/` by default, separate from application data in `.data/`. Each project has its own folder containing Context, artifacts, and Pi sessions. Configure it under **Settings → System → Project workspace**, or set it in the root `.env`:

```dotenv
WORKSPACE_DIR=workspace
```

Use an absolute path such as `WORKSPACE_DIR=/Users/yourname/Projects/make-workspace` for another location. Relative paths resolve from the repository root. Restart the service after changing this setting. The settings dialog shows both the active directory and the configured directory. Saving a different path displays a restart notice without switching files during active work. An explicit WORKSPACE_DIR process environment variable takes precedence and disables editing until that override is removed. The service needs read/write access to that directory.

On first startup with the new layout, legacy `.data/projects.json` and `.data/design/` project directories migrate to the selected workspace if it has no index. File hashes are verified before publishing the new index and removing the originals. Conflicting destinations stop migration without overwriting files. An indexed workspace is opened as-is. Changing WORKSPACE_DIR later opens a separate workspace; to relocate an existing workspace, stop the server, move the entire workspace including projects.json, update the path, and restart.

Both default directories are ignored by Git. The server listens only on `127.0.0.1`; access it using that IP address.

```bash
WORKSPACE_DIR=/absolute/path/to/workspace PORT=4320 npm start
```

| Path | Contents |
| --- | --- |
| `.env` (project root) | Model/search configuration and keys; file mode 0600 |
| `workspace/projects.json` | Project metadata and user notes |
| `workspace/<project-directory>/design.json` | Shared Context, full change history, tasks, and run events |
| `workspace/<project-directory>/artifacts/<artifact-id>` | Immutable artifact files |
| `workspace/<project-directory>/pi/<task-id>/sessions/` | Isolated persistent Pi sessions |

Keys are plaintext in a restricted local file, not encrypted in the system keychain. Configuration reads return only whether keys are configured. Model calls send tasks and required Context to the configured provider; search sends queries to the selected provider, and web fetching accesses the specified public sources.

Run only one server process per workspace and application data directory. This API serves one local user rather than remote tenants. Back up `.env`, the complete configured workspace, and `.data` to restore the application; ZIP exports are artifact snapshots and exclude the private runtime environment.

## Code Layout

The standalone Python [product model engine](model/README.md) provides the first executable DSL v2 contracts, snapshot compiler, lightweight kinematics/logic simulation, and view projections. It includes synthetic offline examples and tests. It is not yet connected to the server, Design Context, or frontend; see its README for supported calculations and explicit limitations.

```text
packages/core/src/design.ts       Seven-role and Design Context contracts
packages/core/src/pi.ts           Isolated Pi 1.3 SDK session factory
apps/server/src/store.ts          Configuration and project metadata persistence
apps/server/src/env-config.ts     .env parsing, validation, and serialization
apps/server/src/design-store.ts   Atomic Context storage, ownership, revisions, dependencies
.pi/agents/                      Separate role Markdown files
.pi/APPEND_SYSTEM.md             Shared Context and knowledge-loading rules
.pi/skills/                      Project knowledge and on-demand references
apps/server/src/agents/           Markdown/Skill loading, scheduling, tool lifecycle
apps/server/src/cad*.ts           CSG modeling, Worker isolation, STL export
apps/server/src/web.ts            Source fetching, search, public-address checks
apps/server/src/design-api.ts     Project API, SSE, evidence, downloads, exports
apps/web/src/components/          Collaboration, Context editor, settings, 3D viewer
```

See [architecture details](docs/ARCHITECTURE.md). The adjacent `../Dreamatic` project provides architecture and interaction references only; Make has no runtime source dependency on it.

## Visual Appearance Review

The product workflow now includes an explicit visual gate: requirements → provisional hardware constraints → generated appearance directions → user review/revision → exact-version approval → detailed engineering. Seven roles remain; Mechanical creates concepts and Orchestrator coordinates the review.

Open **Settings → Image service** and configure an OpenAI Images compatible base URL, independent API key and generation model. Enable reference-image/edit support only when your provider supports multipart `/images/edits` requests with `image[]` inputs. An optional edit model and custom generation/edit endpoints are supported. Size, optional output format and quality must match your provider's capabilities. Originals retain their returned PNG, JPEG or WebP encoding; the server creates JPEG thumbnails. Settings are saved to the root `.env`; saving never sends a billable generation request. Image credentials are never returned to the browser.

Concept cards appear directly in the conversation. Click a concept card to select its direction, use its separate enlarge control to inspect the image, or choose the **Refine this concept** button to provide free-text changes and upload reference images with form/color/detail purposes. Selection does not approve a design. **Approve and continue** records the exact concept revision and starts the next orchestration request; if the text provider is unavailable, approval remains saved and continuation can be retried. Revisions retain earlier images and permit comparison with the source version. Use **Explore alternatives** for a fresh direction. Agent-generated prompts are governed by `make-appearance-prompting` and review by `make-appearance-review`.

Image jobs persist as Context entries with model/config revision, prompt, input revisions, references, feedback, lineage and output Artifact IDs. Jobs expose queued/running/succeeded/failed/cancelled/interrupted states. Retrying an unsuccessful image updates the same concept entry and card in place, retaining its design version and tracking an attempt count. Only actual design revisions create new versions. Failed image jobs can be retried independently while orchestration is still running; duplicate retries of an older attempt are rejected. Failed jobs require explicit retry because an interrupted provider request may already have incurred charges. Restarted services mark unfinished image jobs interrupted rather than automatically replaying them. Request timeouts do not limit the total project runtime. Cancelled jobs cannot cancel work already accepted by a remote provider.

Production Pi runs initialize the mandatory review gate, including existing projects when they next run. Server tool adapters block CAD, mesh and firmware outputs until the current version is approved. Changed requirements or referenced hardware invalidate dependent concepts; a revised approved direction requires fresh approval. Concept images are visualizations, not dimensioned CAD or evidence of printability, fit, thermal performance, flashing or physical testing. Internal deterministic drivers may omit the gate when exercising isolated legacy tool fixtures.

Reference uploads are limited to PNG/JPEG/WebP images of up to 8 MiB and supported dimensions. Project images are served as inert same-origin resources and included in project exports. Provider-returned image URLs are fetched through the public-network adapter without forwarding API credentials. No paid models are called in automated tests.
