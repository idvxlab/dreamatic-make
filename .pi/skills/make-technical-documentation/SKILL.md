---
name: make-technical-documentation
description: "Write prototype assembly, wiring, flashing, and troubleshooting documentation from current BOM, CAD, firmware, and validation records. Use for build tutorials and delivery indexes; return missing engineering facts to owners rather than inventing them."
metadata:
  roles: "documentation"
---

# Build Tutorials and Delivery Documentation

Write all durable technical documents in English. Find the adopted components, printed parts, files, and versions in current Context. Check for needs_review inputs first. Label outdated instructions as drafts; do not infer final configuration from historical chat.

Follow the real build sequence: prepare materials/tools, print and test fits, identify parts, position and mount components, check wiring, prepare firmware, flash, verify startup, and troubleshoot. Do not require fitting an obstructed part after closing an inaccessible assembly.

Make part numbers, orientation, fastener specifications, wiring, and source paths traceable. Reference illustrations only when actual image/diagram files exist. Otherwise describe the missing illustration without claiming it was generated.

Generate assembly-guide.md and delivery-index.md, splitting out wiring.md or firmware-guide.md when useful. Reference artifact IDs and relative filenames. Exports reconstruct current referenced files under current/<role>/. Separate test records from operating steps; untested procedures must not be described as successful.

Tie troubleshooting to observations, possible causes, and an ordered check sequence. Return missing specifications to hardware or firmware owners. Update tutorial dependencies and review only affected steps after engineering inputs change.
