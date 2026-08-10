---
id: liskov-cooling-inspection
type: todo
status: planned
board: true
verification: operator
disposition: blocked
origin: packages/docs/plans/2026-08-09_homelab-capacity-right-sizing-remediation.md
source_marker: false
---

# Inspect liskov cooling before the 24-job soak

The capacity rollout raises only the count cap, but the historical Ryzen Tctl
peak reached 99 degrees Celsius. Physical cooling inspection is an operator
prerequisite before ordinary CI traffic is allowed to soak at cap 24.

## Remaining

- [ ] Inspect cooler mounting pressure and paste/contact.
- [ ] Confirm pump behavior, radiator and chassis fan operation, fan curve,
      and unobstructed chassis airflow.
- [ ] Record the result in the comment log and authorize or reject the cap-24
      soak.
- [ ] If ordinary CI later sustains AMD Tctl above 95 degrees Celsius for five
      minutes, restore cap 20 through GitOps and require cooling remediation
      before retrying. Do not purchase a replacement cooler based on an
      isolated maximum alone.

## Comment Log

- 2026-08-09 — Created as the physical prerequisite for the capacity
  right-sizing rollout. Source and live checks remain agent-owned; this item is
  blocked only on access to the hardware.
