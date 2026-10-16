---
name: make-appearance-prompting
description: "Write and execute appearance generation/edit prompts for physical prototype concepts. Use before image_generate or image_edit; compare distinct industrial design directions while preserving hardware constraints and revision intent."
metadata:
  roles: "mechanical"
---

# Appearance Prompting

Read the product brief, user preferences, provisional hardware envelopes, and existing accepted/rejected directions. Record unknown dimensions as unknown. Read relevant Context entries and pass their exact IDs as contextIds so changes invalidate the concept. Do not include the review gate or concept entries as contextIds; use parentId for revision lineage. User image references are available as appearance.reference.* entries and image Artifact IDs.

## Distinct, Comparable Directions

Default to three directions unless the user requests a different count. Differentiate silhouette, proportions, stance, interaction arrangement, enclosure split, and material expression; color-only alternatives are insufficient. Each direction needs a clear concept name, a short rationale in description, and a complete standalone English image prompt.

Use consistent camera, background, framing and illumination across alternatives: front three-quarter product photograph, entire product visible, neutral background, soft studio illumination, realistic prototype materials. Describe actual controls, screen, openings and component envelopes. Show an ordinary user/use context only when it aids scale or ergonomics. Avoid mood-board collages, fake dimensions, logos, text overlays, gratuitous glowing accents, impossible floating parts and inconsistent duplicate views. Build visual interest through one intentional form gesture, balanced proportions, readable controls and coherent seams. Include print-aware wall transitions, practical access and plausible assembly. Rendering is a concept, not proof of fit, comfort, thermal performance or printability.

A useful prompt contains: product/use posture; distinctive form and proportions; major controls/display/interfaces; provisional engineering constraints; material/color/finish; camera/composition/lighting; exclusions and unresolved constraints. Do not invent measured component dimensions or claim certification.

## Tools and Outputs

Call image_generate once per direction. It returns an option ID immediately; the service writes immutable image and preview artifacts. Queue the small set first, then use appearance_status(optionId) to wait for each result. Never substitute Markdown, invented image URLs, CAD placeholders or a text-only question for visual concepts. If the service is missing or fails, explain the actual limitation and leave the gate pending; do not claim images exist. Retry only unsuccessful jobs explicitly requested by the user.

For image_edit, pass parentId, parentRevision, feedback, preserve, and relevant references with their purpose. Preserve the approved/selected identity and all features outside the requested changes. Resolve conflicts between the user's changes and engineering constraints before generating. The source concept is automatically added as a real pixel input, never represented by a filename in the prompt. Adding user references requires configured editing support. Edit prompts identify changed regions and retained silhouette, control layout, materials and camera as applicable. Every revision becomes a new version; never overwrite history.

After successful images, call appearance_review with the option IDs and return a concise handoff. The graphical card handles choice, feedback and approval. Do not repeat option descriptions in Markdown or create a parallel ask_user question about the same appearance decision. Reserved appearance.* entries are maintained by tools, not context_update. Deliver the returned option IDs rather than promising a fixed image filename or inventing CAD deliverables during concept work.
