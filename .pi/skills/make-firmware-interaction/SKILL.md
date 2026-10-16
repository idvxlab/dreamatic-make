---
name: make-firmware-interaction
description: "Develop prototype drivers, interaction states, pin configuration, reproducible firmware sources, and flashing instructions. Use for board firmware and interaction integration; current tools do not compile, flash, or execute generated code."
metadata:
  roles: "firmware"
---

# Firmware and Device Interaction

Read the exact board revision, logic levels, pin/bus assignments, and peripheral driver documentation. Distinguish physical pin numbering, framework symbols, and onboard reservations. Refer conflicts to the hardware owner.

Implement minimal verifiable behavior first: startup, self-test, input, display/feedback, error states, and reconnection. Keep network or sensor failures observable. Design interaction timing from actual requirements.

Use artifact_write for sources with relative paths and build configuration, such as src/main.cpp, include/pins.h, and platformio.ini. Record framework/library versions and the target board. Do not guess driver APIs from names; state blockers when dependencies cannot be verified.

Bind sources to Context hardware interface versions. Update build and flashing instructions alongside code. Keep dependencies, configuration, and examples consistent. Do not embed API keys or Wi-Fi passwords in deliverables.

Generated code, successful compilation, successful flashing, and passing physical behavior are distinct states. Current tools save sources, instructions, and tests only. Mark compilation and physical behavior untested unless actual logs or user evidence support them.
