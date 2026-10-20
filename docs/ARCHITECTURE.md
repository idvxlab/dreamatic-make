# Dreamatic Make: Seven Roles and Shared Context

## Layers

The browser imports public configuration and engineering contracts from `@harness/core`. Server code separately imports `@harness/core/pi`. Pi 1.3.0 is an exactly pinned upstream dependency; Make does not copy its model or session internals.

Role instructions live in `.pi/agents/<role>.md`, with shared rules in `.pi/APPEND_SYSTEM.md`. `apps/server/src/agents/definitions.ts` uses Pi Markdown/Skill parsers to load knowledge by role. `AgentRuntime` owns task sessions, tool allowlists, stop signals, and budgets. The orchestrator invokes specialists sequentially through `delegate_task`; specialists cannot delegate further. Each project has at most one active run, and at most three projects run concurrently. Tasks need not invoke every role. Public task creation and resume always enter through the orchestrator; user interfaces do not offer specialist selection. Internal role execution remains available to the orchestrator and isolated runtime tests.

The adjacent Dreamatic project (`../Dreamatic`) provides references for local Context ownership, error correction, independent export snapshots, and session lifecycle. Make has its own product model and does not import Art's Orchestrator/Researcher/Designer/Reviewer/Builder workflows, Skills, or credentials.

## Design Context

Each project's `design.json` contains schemaVersion=1 Context and execution records. Writes are queued by project and committed through a same-directory temporary file and atomic rename. Entry IDs are stable; neither agents nor the editor can change an existing owner.

Entry fields are id, owner, title, content, data, revision, status, dependsOn, artifactIds, updatedAt, and updatedBy.

- content holds readable explanations; data holds structured components, parameters, interfaces, issues, and similar facts.
- Specialists write only their own entries. Cross-role corrections become issues owned by the reporting role or delegation requests.
- API/editor changes are explicit user edits with author and reason retained.
- The base revision and task's actual read revisions must match current entries. Missing references, self-dependencies, and cycles reject the whole update.
- Updating an entry transitively marks dependents needs_review and increments their revisions; affected tasks receive needsReview. The system does not overwrite engineering conclusions or trigger a complete rebuild.
- History records the edited entry's before/after values and affected entry IDs. Exports include full history. There is no one-click rollback API; users can submit explicit new revisions based on historical content.

The system checks versions, references, and geometry rather than proving product facts. ready means available for use/review, not physically validated. User evidence is recorded as reported_not_independently_verified.

Project metadata optionally records `directory`; older projects without it use their UUID directory. New directories use a sanitized name plus UUID. Renaming moves the directory and persists its new name, rolling back the move if metadata persistence fails. Deletion first moves the directory to a temporary sibling, removes the metadata record, and then removes the directory contents; a metadata write failure restores the directory. Queued/running projects cannot be renamed or deleted. Lifecycle API operations, Context writes, and artifact I/O share a reentrant per-project queue to prevent concurrent writes from recreating deleted paths. Project IDs and internal references remain stable.

Projects are stored in the configured WORKSPACE_DIR, defaulting to repository-root workspace/. That directory owns projects.json and one folder per project; HARNESS_DATA_DIR is reserved for application data. Relative workspace paths resolve against the repository root. Startup migrates legacy data-directory projects.json and design/ folders only when the selected workspace has no index, verifies recursive file hashes, publishes the index, then removes legacy sources. Existing indexed workspaces take precedence. The settings API accepts workspaceDir, validates the path and directory permissions, persists WORKSPACE_DIR in .env, and returns active/configured paths with a restart-required flag. Saving never switches the live Store or moves active projects. Explicit process environment overrides prevent conflicting UI changes. Changing WORKSPACE_DIR later selects another workspace, rather than moving an existing workspace automatically. Stop the server before manually relocating the whole workspace.

## Context Budget and Handoffs

`context_overview` returns an index of at most 60 entries per page, recent changes, and at most 40 artifact metadata records. It supports owner filtering and pagination.

`context_read` defaults to the current role's entries, product-definition entries, and dependencies, or accepts explicit IDs. Each read has an approximately 48,000-character content budget; remainingIds identifies deferred entries rather than silently dropping them. Change summaries select recent changes relevant to the read set. Deltas and summaries derive from actual entries, with no second canonical product specification.

Tasks retain actual inputRevisions. Writes check for obsolete inputs; conflicts provide actionable feedback so the agent can reread, evaluate, and revise. Large sources, CAD files, and web references are immutable artifacts read by ID. Role summaries are brief handoffs rather than substitutes for Context.

Updates replace **one whole entry**, rather than using arbitrary JSON Pointer patches. Keep entries focused instead of placing all product information in a single entry.

Search defaults to Serper (https://google.serper.dev/search, POST with X-API-KEY); Brave Search remains selectable. MAKE_SEARCH_PROVIDER selects the adapter, while SERPER_API_KEY and BRAVE_SEARCH_API_KEY are stored independently and never returned by the API. Saving a search key affects only the selected provider. Search responses normalize title, URL, and description and record provider and retrieval time. Authenticated search redirects are rejected; requests retain public IPv4 pinning, size limits, and cancellation.

## Role Tools

Shared tools: context_overview, context_read, context_update, artifact_write, artifact_read, ask_user, request_input, list_skills, use_skill, and read_skill_reference.

Skill bodies under `.pi/skills/` load on demand; system prompts list metadata only. Each task records role-prompt hashes and the paths, hashes, and rationales for loaded Skills/references. These receipts stay outside product Context. New runs read current bodies without scanning user-global directories. See [Agents and Skills](AGENTS-AND-SKILLS.md).

- Hardware, Product, and Validation additionally receive web_search and web_fetch.
- Mechanical additionally receives cad_generate.
- Orchestrator additionally receives delegate_task.

ask_user saves a batch of question entries through the same persistence helper used by the single-question request_input tool. Each tool result returns status=waiting_for_user, requestId, needsInput, and question entry IDs. request_input saves a question entry (with optional options, inputType (single/multiple/text), taskId, and runId) and marks the task/run awaiting_input. The browser-safe pendingQuestionsForRun selector uses saved questions and answer receipts rather than run status; stopped, failed, and interrupted runs retain their cards. The reusable ClarificationCard wraps the shared UserInputForm. The UI renders pending questions with native radio/checkbox choices, an Other option, and free-text fields. POST /api/projects/:id/runs/:run/answer validates question revisions and all required answers, rejects duplicate submissions, and creates an orchestrator continuation. Choice selections are validated against the original options and retained as selectedOptions. AgentRun.userAnswers retains the authoritative answers; prompts include the original questions and answers alongside previous work. Pi sessions pause after a question tool finishes; needsInput propagates through delegate_task and blocks further specialist dispatch. A model that returns an explicit waiting-for-confirmation heading without a question receives one repair turn with question tools only. If repair fails, the original text is retained as a free-text question rather than inferred options. Tests use local mock streams, never paid models. A task must save Context/artifacts or complete a valid delegation to count as completed; chat text alone is not a deliverable. Agents must report capability gaps explicitly. Durable technical documentation is written in English; conversational language remains independent.

Geometry recipes are restricted JSON with at most 100 nodes and depth 9. Operations are box, cylinder, translate, rotate, union, subtract, and intersect, with $name parameter references. JSCAD normalizes, triangulates, and checks geometry, exporting JSON, OpenSCAD, and STL. A Worker enforces timeout and heap limits rather than executing arbitrary model-provided scripts. STEP, finite-element analysis, and slicing verification are unavailable.

## Sessions and Recovery

Pi sessions use an explicit model, isolated agentDir, persistent SessionManager, custom resource loader, and tool allowlist. Credentials are assembled only in session memory. Sessions do not load user ~/.pi, other projects' instructions, or default shell tools.

Run states: queued → running → completed / awaiting_input / failed / stopped. Unfinished runs become interrupted after server restart. Stopping propagates cancellation to model calls, web requests, and CAD Workers. Committed Context and artifacts remain saved.

Resume creates a new run with resumedFrom, prior task summaries, and current Context; it does not replay historical tools. Runs have no fixed elapsed-time, model-turn, tool-call, or delegation cutoff. Normal pauses/stops occur for user input, explicit user cancellation, and server shutdown. Individual web/CAD operations retain their own timeout and size limits. Three consecutive failures of the same tool with identical arguments stop the current run. There is no cross-process scheduler; multiple server processes must not write the same workspace concurrently.

## API and Interface

Existing routes /api/config, /api/projects, and /api/runtime/diagnose remain. Additional routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/agents | Seven roles and capability descriptions |
| PATCH | /api/projects/:id | Update name/notes with updatedAt; rename moves the project directory |
| DELETE | /api/projects/:id | Confirmed permanent deletion with updatedAt; removes project directory and metadata |
| GET | /api/projects/:id/design | UI snapshot with latest 15 runs, 160 events, and 50 brief changes |
| GET | /api/projects/:id/context | Full Context and history |
| PATCH | /api/projects/:id/context | Explicit single-entry user update |
| POST | /api/projects/:id/runs | prompt; always routed through orchestrator |
| POST | /api/projects/:id/runs/:run/stop | Stop current run |
| POST | /api/projects/:id/runs/:run/resume | Explicitly resume |
| GET | /api/projects/:id/events | SSE change notifications, coalesced over 400 ms |
| GET | /api/projects/:id/artifacts/:artifact | Download immutable artifact |
| POST | /api/projects/:id/evidence | Raw file body up to 8 MiB; name/description query parameters |
| GET | /api/projects/:id/export | ZIP snapshot with hash verification |

The browser fetches a workspace snapshot after lightweight SSE notifications and coalesces reads for the same project. Project switching remounts the complete project workspace, resets drafts, panels, questions, and artifact selection, and disposes the previous project session. Each session cancels its in-flight snapshot request, closes and detaches its event stream, ignores late callbacks, and validates the returned Context projectId before updating the UI. Text-artifact reads also ignore responses after cancellation. Offline regression tests cover delayed responses, stale errors, mismatched project IDs, request coalescing, and rapid A/B/A switching. Dynamically loaded Three.js/STLLoader supports mesh rotation and zoom. Context, BOM, sources, issues, and exports share one project workspace.

## Data and Source Boundaries

Production configuration lives in the project-root `.env`, independently of the project data directory. Store accepts an explicit configuration path; tests and the offline demo use isolated temporary `.env` files. Writes atomically replace configuration with mode 0600, preserve unrelated variables and comments, and retain revision checks and secret redaction. On startup, a missing `.env` is created from legacy data-directory config.json when present, then that legacy file is removed. Existing `.env` files take precedence. PORT, HARNESS_DATA_DIR, and WORKSPACE_DIR may be set in `.env`; process environment values override those startup settings. Configuration is read directly rather than copying model secrets into process.env.

Local Host/Origin checks come from the base harness. Known project/artifact IDs determine file paths. Export includes only allowed data and artifacts, excluding configuration, sessions, and caches. Artifacts retain SHA-256, size, role, input revisions, and source URL.

Web tools access only public HTTP(S) standard ports. They require public IPv4 DNS results, pin the connection address, and recheck every redirect. Requests have a 20-second timeout and 2 MiB limit. IPv6-only sources, PDF extraction, JavaScript rendering, and logged-in pages are unsupported. Search provider snippets and fetched pages are distinct evidence. Agents must record verification time for changing prices and availability.

Generated HTML, SVG, and code are served as attachments with sandbox CSP rather than executed as application scripts. Firmware files do not run automatically. Uploaded photographs/PDFs are retained as evidence, but the current text model has no binary visual interpretation capability.

The API is a local single-user service and does not prevent other local processes from accessing it. Remote deployment requires separate authentication and authorization design.

## Verification

Tests cover ownership/conflict/cycle/invalid-reference rejection, atomic transactions, transitive invalidation, targeted reads, real CSG geometry and STL, seven-role tool collaboration, awaiting-input behavior, stop/resume, ZIP isolation and integrity, public-source boundaries, project APIs, and a local mock OpenAI SSE endpoint driving **real Pi** CAD and Context calls. All tests are offline or loopback-only and do not call paid models.

## Workflow Contracts and Recovery

TaskContract records objective, editableEntryIds, expectedEntryIds, expectedArtifactNames, acceptanceCriteria, and dependsOnTaskIds. The public Pi delegation tool requires a contract; internal deterministic drivers retain compatibility with older fixtures. Dependencies must be completed tasks, and Context writes are restricted to the delegated IDs. Delivery inspection checks newly produced expected entries are ready, expected artifact names are among task outputs, and read inputs remain current. It does not automatically certify the meaning of acceptance criteria; independent validation must provide engineering evidence.

Tasks may be partial or blocked. Unresolved failed/partial/blocked specialists make a run partial. A successful same-role retry with explicit retryOf resolves its predecessor. Continuation runs store inheritedAnswers gathered from their complete ancestry; questions and direct answer receipts remain separately auditable. pendingInputRuns returns outstanding questions independently of the last 15 runs. UI merges these records by run ID.

Specialists persist clarificationProposals in task records; the orchestrator routes and deduplicates them into coordinator-owned question entries and pauses. Delegation returns refreshed Context facts along with updated read versions. Success resets the consecutive identical-error guard. Length recovery counts successful engineering writes rather than reads and failed tool completions.

## Appearance Concepts and Approval

`appearance.option.<uuid>` entries are tool-maintained, Mechanical-owned records containing durable image job state, direction/version lineage, prompt, feedback/preservation instructions, image reference purposes, config revision, model and original/preview Artifact IDs. Original images are immutable `image` artifacts; the service decodes bounded raster formats and creates JPEG previews. Binary contents stay outside text prompts. `appearance.reference.<artifact-id>` records preserve user-provided reference purposes. There is no second canonical design database.

`appearance.review` is the Orchestrator-owned version-bound gate. Its approval is written only through the explicit user review endpoint, with optimistic checks on the gate and option revisions, latest direction version, source revisions and completed image existence. Generic Context writes reject reserved appearance entries. Concept tools cannot claim user approval. A user-triggered revision of the approved direction clears approval immediately and invalidates dependent engineering entries. Input changes invalidate concepts and gate through the existing Context dependency graph. CAD/mesh/firmware adapters assert current approval; generated engineering artifacts and associated Context entries bind the review dependency. Delegation declares research/concept/engineering phase. Preparatory research remains available before approval.

`AppearanceService` manages bounded global concurrency and durable project job records. Request configuration is captured per job; each request has an independent timeout and no automatic retry. Queue cancellation and service recovery retain earlier outputs. External image downloads use checked/pinned public addresses, bounded bytes and no provider authorization header. OpenAI Images compatible generation and multipart editing are the first adapter; other APIs require an explicit adapter rather than only a different model name.

`DesignReviewCard` renders the image choices inline in the project conversation, including retained concepts whose originating runs fall outside the recent timeline. It supports enlarge, select, approve, revision feedback/reference uploads, previous-version comparison, history, cancellation and explicit retry. Successful approval is retained if automatic orchestration continuation fails. Existing clarification cards remain for nonvisual questions; appearance review does not create duplicate Markdown option lists.

## Product model integration

`apps/server/src/product-model.ts` runs the standalone Python DSL engine in bounded child processes. Its project API persists model/source pointers and simulation evidence through DesignStore with optimistic versions, source dependencies and exact appearance approval checks. `packages/core/src/product-model.ts` contains browser-safe projection contracts. `ProductModelWorkspace` and `EngineSceneViewer` share a simulation timeline across scene, collision, circuit and flow views; the existing STL viewer remains available. See [product model integration](PRODUCT_MODEL.md) for setup, protocol and limits.
