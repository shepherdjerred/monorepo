# SSD Price Outlook — Next 12 Months (research Q&A)

## Status

Complete

## Question

Are SSD prices likely to keep rising over the next 12 months (mid-2026 → mid-2027),
or fall? Context: homelab drive purchasing decision following the `nvme0` ZFS pool
suspension on torvalds (2026-06-25).

## Answer

**Keep rising / stay elevated — not fall.** Analyst consensus is near-unanimous; no
credible source forecasts a decline within the next 12 months.

### Why (structural, not cyclical)

- Wafer capacity is being reallocated to HBM for AI accelerators (~3:1 HBM-vs-conventional
  trade ratio); this self-reinforces rather than self-corrects.
- AI datacenter demand absorbs NAND; enterprise/datacenter SSDs ~60% of global NAND output.
- Demand growth ~20–22%/yr vs supply ~15–17%/yr.
- New fab capacity (e.g. Micron ID1) not online in volume before late 2027.
- Phison CEO: all 2026 NAND production already sold out; "pricing apocalypse throughout 2027."

### Trajectory already observed

- NAND contract price QoQ: +33–38% (Q4'25), +85–90% (Q1'26), +70–75% (Q2'26 projected). ~246% across 2025.
- Consumer 1TB SSD ~$45 → ~$90. Samsung 990 Pro 2TB $189 low (2025) → 9100 Pro 2TB ~$478 (Apr 2026).

### Timeline for relief

- Next 12mo: elevated, likely still climbing.
- Late 2027: earliest credible relief as new fabs ramp.
- 2028–2029: realistic normalization, only if AI demand doesn't accelerate; floor likely resets higher.

### Practical takeaway

Buy drives sooner rather than later. Waiting for a dip is the losing bet in this window.
Hedge: used/older-gen NVMe or larger HDDs for cold ZFS tiers.

## Sources

- TrendForce via Tom's Hardware — Q2 DRAM/NAND contract price climb
- Phison CEO (Tom's Hardware) — doubled prices, 2026 sold out
- Storage Swiss — "Memory and Flash Prices Are Not Coming Down (Through 2027)"
- TrendForce 20260331 press release — AI server demand drives 2Q26 increases
- IDC — Global Memory Shortage Crisis 2026

## Follow-up: Plateau vs. Return-to-Normal (RAM + SSD)

"Plateau" (stops rising) and "return to normal" (actually cheaper) are distinct milestones,
and RAM is ahead of SSD in the cycle.

| Milestone             | RAM (DRAM)                     | SSD (NAND)                                         |
| --------------------- | ------------------------------ | -------------------------------------------------- |
| Peak / still climbing | Peaks ~Q1–mid 2026             | Still climbing through 2026 (2026 output sold out) |
| Plateau (high, flat)  | Late 2026 → holds through 2027 | Later — into/through 2027                          |
| Gradual easing        | 2027 (slow)                    | Late 2027 (new fabs ramp)                          |
| "Return to normal"    | 2028–2029                      | 2028–2029                                          |

Key nuances:

- RAM leads SSD in the cycle; SSD has more upside runway left → prioritize SSD purchase now.
- "Normal" ≠ pre-2024. Permanent floor reset ~30–50% above 2024 (some say 60–100%).
- Tail risks: SK Hynix CEO says shortage could run to 2030 (later); oversupply whiplash risk
  in 2028–2029 if AI demand moderates as capacity lands (earlier).

Added sources: Blocks & Files (supercycle through 2028), SoftwareSeni (DRAM normalization
timeline), Yahoo Finance (memory prices may not fall until 2027), Wikipedia (2025– memory
shortage), IQON Digital (RAM 2026–2028 forecast).

## Session Log — 2026-06-25

### Done

- Researched SSD/NAND price outlook via WebSearch + WebFetch (TrendForce, Tom's Hardware,
  Storage Swiss, IDC). Delivered a sourced answer in chat and this log.
- Follow-up: separated plateau vs. return-to-normal timing for both RAM and SSD; added
  DRAM-specific sources and the permanent-higher-floor caveat.

### Remaining

- None. (Optional follow-up: if buying, comparison-shop specific homelab NVMe models.)

### Caveats

- Forecast assumes AI infrastructure demand grows at current pace; faster acceleration pushes
  relief past 2027. Numbers are contract-price forecasts; street/retail prices lag and vary.
