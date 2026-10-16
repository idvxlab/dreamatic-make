# Dreamatic Make development

- New product code lives in this repository. The reference Dreamatic Art project is at `../Dreamatic`; read it when useful, do not modify it without a request.
- Use released Pi SDK packages as upstream dependencies. Do not fork runtime internals or migrate old Art workflow roles/tools.
- `packages/core` exports browser-safe contracts; server-only SDK integration is `@harness/core/pi`.
- `apps/server` owns Context storage, application policy, agent orchestration and tool adapters; `apps/web` owns UI.
- Maintain the seven role instructions in `.pi/agents/<role>.md` and shared collaboration rules in `.pi/APPEND_SYSTEM.md`. `agents/definitions.ts` is the loader, not a second prompt source.
- Project Skills live in `.pi/skills/<name>/SKILL.md`, selected by metadata.roles and loaded on demand. Preserve knowledge receipts and reference directory isolation. Include `.pi/` when packaging.
- Preserve Context ownership, read-version checks, dependency invalidation and source evidence.
- Context is authoritative. Keep artifact contents outside model prompts unless needed. Do not create a second canonical BOM or product specification.
- Never claim physical validation, compilation, slicing, flashing or procurement occurred without actual evidence/tool execution.
- Keep credentials server-side. Do not log/return key values, commit `.data`, `workspace`, or `.env`, or load legacy credentials automatically.
- Run `npm run check:knowledge`, `npm run check`, `npm test`, and `npm run build` after substantive changes. Tests stay offline/use a local mock provider; never call paid models in tests.
- Maintain repository documentation, Agent and Skill instructions, and generated technical-document templates in English. UI localization and conversational language are independent.
