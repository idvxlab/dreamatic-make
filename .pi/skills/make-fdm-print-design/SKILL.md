---
name: make-fdm-print-design
description: "Evaluate FDM prototype part separation, print orientation, supports, joints, and fit tests. Use for print manufacturability and tolerances; do not generalize calibration values or generate G-code without slicer verification."
metadata:
  roles: "mechanical, validation"
---

# FDM Printing and Fit Tests

Obtain printer build volume, nozzle/layer settings, material, actual calibration, loads, and temperature requirements. Without equipment details, keep settings provisional and list what needs checking.

Evaluate orientation against layer strength, visible surfaces, bridging, overhangs, support removal, and bed contact. An internal opening does not establish that supports can be removed or tools inserted after printing.

Compare screws/inserts, snap fits, press fits, and adhesives using disassembly frequency, tools, wall thickness, and print orientation. Base clearance and hole compensation on actual process calibration. Mark untested fits as pending calibration; do not provide a universal correct tolerance.

Prefer local test coupons for holes/posts, connector windows, snaps, inserts, and cover fits. Record dimensions, printing conditions, measurements, and adopted corrections before spending material on the full enclosure.

No slicer is currently available. Do not claim successful slicing, printable G-code, or measured print time. Deliver per-part orientation recommendations, material assumptions, support checkpoints, and fit-test steps pending user evidence or a dedicated adapter.
