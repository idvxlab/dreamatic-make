---
name: make-hardware-sourcing
description: "Select boards, modules, and standard parts for buildable terminal prototypes. Use for hardware specifications, revisions, interfaces, BOM, procurement evidence, and substitution compatibility; search snippets do not prove specifications or stock."
metadata:
  roles: "hardware, validation"
---

# Hardware and Component Sourcing

Choose components from functional and interface requirements, then compare supply requirements, logic levels, pin usage, mounting, driver support, availability, and total cost. Distinguish open-source hardware, commercial modules, standard parts, and third-party compatible products. A purchase link does not establish open-source status.

Use web_search to find manufacturer documentation and suppliers, and web_fetch to read pages used as evidence. Match the exact model and board revision. If a page cannot be retrieved, record it as unverified; never infer mounting dimensions, price, or stock from snippets.

Use one hardware entry per component with data.kind set to component. Record name, model, version, quantity, dimensionsMm, voltage, pins, sourceUrl, purchaseUrl, cost, currency, checkedAt, and uncertainties. Add a sources array when multiple references are used. Set checkedAt only for actual verification; do not invent retrieval dates.

Distinguish board outline, tallest components, mounting holes, connector orientation, and mating clearance. Use explicitly labeled envelopes for missing measurements and request physical measurements. Include peak loads and the basis for margins in the power budget; leave unknown peaks pending verification.

Include cables, connectors, fasteners, mounting accessories, and necessary consumables in the BOM. Classify substitutions by direct replacement, mechanical changes, wiring changes, and firmware changes. Obtain the relevant owners' confirmation before updating the baseline.

Without a search key, fetch known public sources or request links. Preserve questions if evidence is unavailable rather than repeating identical failed queries.
