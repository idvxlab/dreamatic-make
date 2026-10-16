---
name: make-parametric-cad
description: "Use Make cad_generate to create parameterized CSG parts, editable recipes, and STL. Use for enclosures, brackets, openings, part separation, and modeling iteration; STEP, complex surfaces, slicing, and strength analysis are unavailable."
metadata:
  roles: "mechanical"
---

# Parametric Mechanical Design and CAD

Read adopted component dimensions and interface entries before modeling. Standardize millimeters, coordinate origins, and assembly directions. Allow space for component envelopes and heights, plugs, cables, fastening tools, and assembly paths.

Separate printable parts. Give each a stable ID, material/process assumptions, mating relationships, and mounting details. Deliver enclosure, cover, buttons, and brackets separately; a display-only Boolean union does not replace individual part files.

The parametric recipe is the design source; STL is a derived mesh. Parameterize key dimensions and rebuild affected parts when they change, preserving unaffected artifacts. Geometry checks from cad_generate establish only reported properties, not tolerance, strength, assembly, or print success.

Read [references/csg-recipes.md](references/csg-recipes.md) when needed before calling the tool. It defines the current recipe schema and limits. Without the corresponding tool, save source files or plans and explain that generation was not performed.

Attach recipe/source/mesh/report artifact IDs to mechanical entries and declare input dependencies. Hand off assembly directions, the part list, unknown fits, and a fit-test plan.
