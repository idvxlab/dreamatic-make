# Product model workspace

The **3D models** project tab combines the product DSL engine with the existing STL viewer. The engine offers motion, collision, circuit/logic and material-flow views of one frozen snapshot. No provider requests are needed.

## Setup

Install Python 3.11+ and the root package, normally in `.venv`:

```sh
python -m venv .venv
# Activate .venv with the command appropriate to your shell.
python -m pip install -e .
npm run build
npm start
```

The server discovers `.venv/Scripts/python.exe` on Windows or `.venv/bin/python` elsewhere. Alternatively, set the **process environment variable** `MAKE_MODEL_PYTHON` to an interpreter with the project's pinned dependencies before starting the server. It accepts a single executable path, not shell commands or arguments. Without either setting, the server tries `python` on Windows or `python3` elsewhere. The engine is optional: an unavailable interpreter produces an actionable error in the model panel without disabling the rest of the application. Do not put credentials in this variable. Runtime variables are not exposed as browser configuration.

## Workflow

1. Open a project and its **3D models** tab. Try the actuator, fan or lamp example. These synthetic runs are transient and never create project evidence.
2. Select a `model_bundle` JSON and its matching `scenario` JSON, then **Import & validate**. The scenario must bind the bundle's canonical snapshot hash; use the Python compiler to generate it. Examples are under `model/examples/`. Those files reference `synthetic-fixture` revision 1; use the transient example buttons unless you have explicitly created the matching Context fixture. For real imports, bind actual project inputs and regenerate the snapshot/scenario hashes.
3. Import compiles the model, checks the scenario's initial state, saves a source artifact and records its ID in `mechanical.product_model`. Import does not claim full scenario validation. Unsupported features remain visible in diagnostics.
4. **Run simulation** executes the saved pair after the current appearance version has been approved. The result is saved as an immutable evidence artifact referenced by `validation.product_model`. The entry stays a draft; completion is not approval or physical validation.
5. Scrub or play the timeline. Body poses, collision pairs, nets, behaviors, sensors and effects come from the same recorded frame. Clicking geometry, topology nodes or an entity selector opens its projected data. Use **Download result** for the complete trace and projections. A page reload reuses saved results when their versions are still current.
6. To edit parameters or the scenario, update the DSL files, regenerate required definition/snapshot hashes and import again. The first web integration does not include an in-browser DSL editor. STL/CAD artifacts remain below the engine panel and in Files.

## Persistence and consistency

The Context source entry is the authoritative pointer to one immutable `{bundle, scenario}` artifact; the server does not create another BOM or product specification. Artifact contents are not added to agent prompts. `bundle.input_revisions` must refer to existing, current Context entries and cannot depend on the model or its downstream results. Imports use optimistic `baseRevision` checks. Reimporting invalidates downstream simulation entries through the existing Context dependency graph.

Simulation captures the source revision, declared input revisions and exact approved appearance/gate revisions. Before publishing, the server checks these again inside the project's exclusive operation queue. Changes while Python is running reject publication with HTTP 409. Deleted projects cannot receive results. Generic Context patches cannot modify the two engine-maintained entries. Mechanical owns the source; Validation owns software evidence.

The Python process has no credentials or provider tools. It receives inline JSON through stdin and emits a bounded JSON response. There is no model-supplied Python, shell execution, filesystem asset import or network request. Process spawning has `shell: false`; the adapter uses a minimal environment, a 30-second timeout, a 1 MiB input limit and an 8 MiB output limit. The app permits one active operation per project and two across the server. Disconnecting or cancelling aborts the worker; aborted work cannot publish results. A completed write may already be saved when cancellation arrives, so reload Context after cancelling near completion.

## Project APIs

All routes inherit the app's loopback/origin restrictions and project ownership checks.

| Route | Input | Result |
| --- | --- | --- |
| `GET /api/projects/:id/model` | — | Current preview or saved simulation |
| `POST /api/projects/:id/model/import` | `{bundle, scenario, baseRevision}` | Validated initial preview and new source revision |
| `POST /api/projects/:id/model/simulate` | `{baseRevision}` | Saved simulation, projections and result artifact ID |
| `POST /api/projects/:id/model/demo` | `{name: "actuator" \| "fan" \| "lamp"}` | Transient example run |

Response: `{workspace, sourceRevision, demo, resultArtifactId?, stale?}`. Workspace types live in `packages/core/src/product-model.ts`; the Python package remains the schema/solver authority. The new CLI `preview` and `workspace` operations also support the existing single-request protocol. `preview` resolves time-zero placement without returning a full-run result; `workspace` returns a trace and initial scene/circuit projections. The UI applies frame poses and samples during playback.

## Limits and evidence

- Kinematics and ideal logic are lightweight approximations. There is no force/torque, SPICE, thermal, fluid or particle solver. Material flow is topology only.
- The viewer displays primitive envelopes, not printable CAD or imported visual/convex assets. Unknown body placement is hidden rather than fabricated at the origin. Envelope margins and conservative collision approximations are reported by the engine; the viewer draws the base shapes. Collision mode colors reported pairs red; an empty list is not a safety conclusion.
- The initial prototype has one active model pair per project and file-based editing. It does not add an autonomous agent modeling tool or silently convert existing STL files to articulated models. Agents may prepare source artifacts with existing tools; importing/executing them is explicit in the workspace.
- Standard engine limits still apply. Long traces should use a larger step or shorter duration. Topology diagrams display at most 120 nodes; full projections remain in the downloaded result. Structured diagnostics may contain English engine messages even with Chinese UI selected.

## Offline verification

```sh
python -B -m unittest discover -s model/tests -v
npm run check:knowledge
npm run check
npm test
npm run build
```

Set `MAKE_MODEL_PYTHON` during `npm test` to enable the real Python adapter integration test. Other server tests use an offline injected runner to verify Context persistence, optimistic conflicts, approval changes, cancellation, project isolation and HTTP policy. No paid models are called.
