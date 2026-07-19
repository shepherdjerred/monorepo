---
id: log-2026-07-18-ci-capacity-options-research
type: log
status: complete
board: false
---

# CI Capacity Options Research — Buildkite Agent Compute

## Measured usage (Buildkite REST API, pipeline `sjerred/monorepo`)

| Window                                                 | Builds | Jobs   | Job-hours | Duty cycle | Avg concurrency while active |
| ------------------------------------------------------ | ------ | ------ | --------- | ---------- | ---------------------------- |
| 2026-05-15 → 06-14 (dynamic-pipeline era, "typical")   | 1,547  | 74,853 | **678**   | 9%         | 10.4                         |
| 2026-06-18 → 07-18 (static pipeline + CI firefighting) | 1,201  | 29,629 | **845**   | 11%        | 10.4                         |

Key facts:

- CI is **off ~90% of wall-clock hours**, but active time runs ~10 jobs deep —
  so pay-per-use billing is driven by the ~700–850 monthly job-hours, not the
  low duty cycle. Peak in-build concurrency: p50=9, p90=24, max=35.
- Pay-per-use beats a flat-rate box only below **~200 job-hours/mo** (spot,
  1 agent/instance) or ~400 (packed). Both measured eras are 2–4× past that.

## Options evaluated

| Option                                          | $/mo at ~680 job-hrs       | Pipeline changes                                                            | Verdict                                                                                         |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Hetzner/OVH bare metal as tailnet k8s worker    | ~$50 flat                  | none                                                                        | **recommended**                                                                                 |
| Used-DDR4 second homelab node (~$550)           | ~$21 amortized             | none                                                                        | later, optional                                                                                 |
| New-build DDR5 node (~$1,250)                   | ~$41 amortized             | none                                                                        | no — RAM shortage                                                                               |
| AWS Elastic CI Stack (spot, scale-to-zero)      | ~$95–150                   | major (k8s plugin → VM steps, secrets → S3/SSM, AMI/docker-plugin strategy) | no at this volume                                                                               |
| GCP / Azure                                     | ~$150 + tooling            | major                                                                       | strictly worse than AWS (Elastic CI Stack is AWS-only; GKE/AKS + agent-stack-k8s or DIY scaler) |
| Buildkite hosted agents ($0.004/vCPU-min Linux) | $650–1,300                 | major + hybrid queues (deploys can't leave tailnet)                         | dead on arrival                                                                                 |
| Buildkite Enterprise "white-glove"              | 30-user min (~$900+ floor) | —                                                                           | not our tier                                                                                    |

## Analysis highlights

- **Dagger removal changed the calculus**: agent pods now ARE the compute, so
  added agent capacity buys real throughput (old analysis would have said the
  remote Dagger engine was the bottleneck). The `buildkite-helper` skill still
  describes the Dagger/dynamic-generator era and needs a refresh.
- **Elastic CI Stack mechanics** (if ever revisited): CloudFormation, ASG
  MinSize 0, Lambda scaler polling scheduled jobs; scales ≈ concurrent jobs,
  wave-2 steps reuse warm instances; knobs: `MaxSize`, `AgentsPerInstance`,
  `ScaleOutFactor`, heavy/light dual-queue stacks. EC2 instances _can_ join the
  tailnet via bootstrap (unlike BK hosted), so the whole pipeline could move.
  Marginal cold-build cost ≈ $0.09 spot / $0.25 on-demand (20-min job).
- **Scale-to-zero fallacy**: "CI is off >75% of hours" is true (88–91%) but
  irrelevant — elastic never bills idle anyway; the bill tracks job-hours,
  which are high because active time is ~10 deep.
- **RAM shortage (2026)**: 64GB DDR5 kits $600+ (was ~$180 mid-2025), no
  relief forecast within 2026 (Gartner). New-build payback vs renting Hetzner
  ≈ 27 months → rent now, buy hardware when DRAM normalizes. Renting Hetzner
  arbitrages the shortage (their fleet RAM predates the spike).
- **Hetzner box integration path**: `tailscale up` → add as Talos worker →
  agent-stack-k8s/Kueue schedule unchanged → bump Kueue quota (currently
  16 CPU / 64Gi). Caveats: `ci-base:latest` has `imagePullPolicy: Always`, so
  a WAN worker wants a registry pull-through cache; WAN worker joins the
  cluster failure domain (etcd stays home).

## Recommendation (initial): rent Hetzner

Rent a **Hetzner AX42 (~€49/mo, 64GB DDR5 ECC, 2×512GB NVMe)** or a
[Server Radar](https://radar.iodev.org/) auction box, join it to the tailnet
as a Talos worker, raise the Kueue quota. Zero pipeline changes.

## Revised direction: buy used EPYC server (owner's squeeze thesis)

User's thesis: the DRAM shortage runs 3–4 years and rents ratchet (Hetzner's
2026-06-15 adjustment raised cloud 33–170%, dedicated €5–50/model — existing
rentals grandfathered, but grandfathering is customary, not contractual; cf.
2022 energy surcharge). Over a 48-month horizon even flat rent ($2,544)
loses to owning; rent-and-reassess only wins if the memory cycle turns before
the ~27-month new-build payback. Low-capital used hardware is robust in both
scenarios.

Key findings that shaped the final spec:

- **Dual-socket old Xeon** (LGA2011-3/3647): cheapest cores + unlocks cheap
  DDR4 RDIMM, but ~⅓–½ Zen4 single-thread (verify wall-time regresses) and
  a $12–20/mo power tax. Rejected for CI.
- **HN consensus** ("used EPYC homelab"): single-socket EPYC Rome/Milan on
  Supermicro H12SSL / ASRock ROMED8-2T; RDIMM is the memory class the AI
  boom isn't eating (8 channels, expandable to 512GB); Milan (Zen 3) over
  Rome for single-thread; H12SSL prices rising (LLM-at-home demand).
- **Intel vs AMD**: AMD decisively for CI (per-core speed, one-socket core
  counts, 7nm power). Intel LGA3647 only as a "RAM warehouse" play (used
  R640/DL380 with 128–256GB installed, $500–800).
- **Premade vs parts**: noise/heat no concern (below-house storage room) →
  used enterprise premade beats self-build. **AMD PSB vendor-locking**:
  Dell/HPE/Lenovo fuse EPYC CPUs to their platform on first boot; Supermicro/
  ASRock/Gigabyte/Tyan don't → prefer Supermicro.

### Final spec

Used **Supermicro single-socket EPYC server** (AS-1014S/2014S-class,
H12SSL inside): **EPYC 7402P/7502P** (or Milan **7443P** if close in price),
**4×32GB DDR4-3200 RDIMM = 128GB** (half the slots free → 256GB path stays
cheap), 1TB Gen4 NVMe, from an established refurbisher with warranty.
**~$800–1,100 all-in.** 2U over 1U for lower power/fan RPM. Needs a
hardwired Ethernet run to the storage room. Integration: tailscale → Talos
worker → registry pull-through cache for `ci-base:latest` → Kueue quota bump.

## CORRECTION (same session): Hetzner/OVH rental prices doubled 2026-06-15

The €46–49 AX42 anchor used in the early analysis was **pre-adjustment** —
verified live 2026-07-18: **AX42 = $113/mo** (+$56 setup). Auction repriced
too (i7-6700 €63, Ryzen 7700/64GB €107, EPYC 7401P/128GB €182). OVH: RISE-M
$118, RISE-L (9950X/128GB) $177, SYS-4 $129. A 16c/64GB rental is now
$113–177/mo → 4-yr $5.4k–8.5k = **2.7–4× owning**. The rental path is
eliminated; the squeeze the user predicted already happened. Final live
recommendation: **buy** — used DL325 ($1,400–1,610) or DIY 9950X (~$1,900).
torvalds = i9-14900K/128GB (verified via talosctl): consumer DIY ≈ duplicates
it (9950X = 112%); used EPYC = +28% throughput but ~40% slower serial (pin
verify to torvalds if chosen); TR 9970X = only true tier jump (224%).

## Live market sweep (2026-07-18, eBay via PinchTab + webstores + r/homelabsales)

Market reality vs earlier estimates — everything RAM-adjacent has spiked:

- H12SSL boards: **$800–900** (was ~$450). ROMED8-2T sold on homelabsales for $600.
- Used 32GB DDR4-3200 RDIMM: **~$260/stick (~$8/GB)** — sold comps, not asks.
  128GB kits on eBay: $680–1,300. The "cheap RDIMM" thesis is dead.
- Unlocked EPYC comps: 7543 (Milan 32c) sold $700; 74F3 (24c 3.2GHz) $699 OBO.
- Complete US servers with 128GB: $1,250–1,800. Refurbisher webstores are
  RFQ/business-priced (SaveMyServer R6525 2×7413/128GB: $9,000) — eBay OBO is
  the only deal venue. r/homelabsales moves in days; good for comps + alerts.
- DIY-from-parts Milan 32c at comps: ~$2,700 → parts route dead.
- Consumer DIY flipped viable: 9950X/64GB DDR5 ~$1,800, 4-yr TCO ($2,037)
  now ties used EPYC ($2,026) because of 45W vs 100W idle. 16 Zen5 cores ≈
  87% of 32 Rome cores aggregate, 1.75× single-thread. JetKVM (~$100)
  substitutes for IPMI.

### Shortlist (live 2026-07-18)

1. **HP DL325 G10, EPYC 7452 32c, 128GB, 2×800GB SAS — $1,610 OBO**
   (digitalmind2000, eBay refurb, free returns). Sum-of-parts ~$2,060 →
   under-market. HPE PSB-locked (appliance-only). **Offer ~$1,400.**
   https://www.ebay.com/itm/178246076287
2. unixpluscom CTO path: CSE-826 2U + MZ32-AR0 ($999 bare) — message for
   7402P/7502 + 128GB quote. https://www.ebay.com/itm/158071236420
3. Dell R740XD 2×Gold 6252 48c/128GB — $1,190 OBO (cheap cores, slow
   single-thread, ~170W). https://www.ebay.com/itm/188533852437
4. Fallback: new 9950X DIY ~$1,800 if nothing lands ≤$1,500.

Dual-EPYC (user's wish): complete Rome/Milan duals are $2k+/China-risk;
cheap dual-socket = Intel R740XD trade. Single 32c already 2× pipeline peak.

## FINAL DECISION (workflow-verified, 2026-07-18)

Benchmark correction forced the endgame: real PassMark numbers show the used
servers (DL325 7452: MT 45,969/ST 2,007; R740XD 2×6252: MT 46,010/ST 1,966)
are BELOW torvalds' i9-14900K (MT 58,278/ST 4,690) on both axes — my earlier
"Zen2-unit" estimates overrated them. Only 9950X-class (MT 65,741/ST 4,729)
and Threadripper beat the existing node. With the user's realistic need of
64GB RAM, the used-server path (whose sole unique asset was 128GB pre-crisis
RDIMM) lost to DIY.

A 6-agent research workflow (retail prices, used market via PinchTab,
HN/Reddit community wisdom, benchmark verification, alternatives sweep,
synthesis) produced the final config:

**Buy: ASRock Rack B650D4U ($299, real IPMI + Intel NICs) + Ryzen 9 9950X
($511 Amazon first-party) + 64GB (2×32) DDR5-6000 non-ECC ($830) + SN850X
1TB ($226) + RM850e ($119) + Montech XR ($75) + Peerless Assassin ($33) =
~$2,093** of the $2,500 budget.

Key workflow findings: B650D4U dropped to $299 (kills JetKVM need); ECC
UDIMM 64GB is $1,560/unobtainable (ECC variant dead); EPYC 4565P boxed OOS
with zero perf delta (skip). Runner-up: complete used 7950X/64GB system on
eBay $900 OBO + JetKVM = $989 (escape hatch). Micro Center 9950X bundle
path ≈ $1,667 if near a store.

Build risks + mitigations: (1) ships-with-old-BIOS won't POST Zen 5 —
BMC CPU-less flash before CPU install; (2) ASRock server-board VRM deaths
under sustained load — run 105W eco mode + VRM fan; (3) BMC failover-NIC
bridging + undocumented second admin account — dedicated-NIC mode, user
audit, Tailscale-only; (4) RAM volatility — order RAM first, eBay used
~$410 fallback; (5) Talos AM5 — include amd-ucode Image Factory extension.

Full agent outputs: workflow run wf_8fecee9a-5ab (journal in session dir).

## Build finalization + validation (late session)

New machine named **liskov**. Constraints evolved to: new-only parts (used OK
for RAM), 128GB DDR5, budget raised to $3,500, targets ≥1x ST+MT vs the
14900K node (ideal 1.5x MT; 1.5x ST is physically unavailable — best silicon
≈1.08x).

PCPartPicker lists created via PinchTab (headed Chrome to pass Cloudflare
Turnstile on login; instance left headed, multiInstance.strategy set to
`explicit`): **liskov-128gb-proart** = 9950X ($511) + ASUS ProArt
B650-Creator + Noctua NH-U14S + used 128GB DDR5 (placeholder) + SN850X 1TB
(OS) + SN850X 2TB (cache: bun/docker/turbo) + RM850e + NanoKVM-PCIe + case
placeholder ≈ $2,256 + real RAM. https://pcpartpicker.com/list/cHJW9K
(also saved: liskov-64gb, stale liskov-128gb — deletable).

Decisions: ProArt over Tomahawk/Strix (user preference; dual Realtek NIC
mitigable w/ $25 Intel i226 if Talos sulks), Noctua air over AIO (unattended
box: pump = liability), NanoKVM-PCIe over server-board BMC, 9950X over
9950X3D/X3D2 (V-cache ≈ nothing for CI; GN "DO NOT BUY" on X3D2) and over
i9-14900KS ($801, -9% MT, max-voltage degradation SKU) / 285K (-8% MT).
torvalds verified DDR5 (4× Corsair CMK64GX5M2B6400C32, ASUS board) → sticks
interchange between machines.

**Validation workflow verdict (6 agents): PASS for the 9950X list; reject
TR 9960X** — real PassMark 92,347 (1.58x, clears ideal MT) and compile
benchmarks confirm TR cores translate (~1.68x kernel compile), BUT: ST
4,571 = 0.97x fails the ≥1x floor; budget ~$3,697 (needs dGPU — no iGPU/no
TRX50 video out → NanoKVM blind; E-ATX case; $140 TR5-SP6 cooler); RDIMM-only
platform with unpriced used market. Amendments adopted: (1) 2x64GB not
4x32GB; (2) flash ProArt BIOS 3603+ via FlashBack before first boot (64GB
DIMM + 9950X support); (3) bench-test pre-boot HDMI with NanoKVM — known
ASUS forum report of no POST/BIOS HDMI on this board+Ryzen 9000.
Live eBay check: used/new 128GB DDR5 trades $1,200–1,400 (over the $850
placeholder, within the $2,094 headroom). Realistic all-in: **$2,600–2,800**.
Headroom is a RAM reserve — not for X3D/TR/new-RAM/dGPU.

## PURCHASED (2026-07-18)

- **RAM bought**: G.Skill Ripjaws S5 128GB (4×32GB, 2× F5-5600J2834F32GX2-RS5K
  kits — DDR5-5600 **CL28** premium bin) — **$1,349.97**, eBay
  https://www.ebay.com/itm/127972871269, used, **30-day returns**, seller
  ~99.5%/7.7K. Chosen over: Crucial 2×64 NEW auction (~$1,200+11 bids, no
  returns) and Corsair 4×32 auction ($630+, no returns) after a ~65-listing
  eBay sweep. Note: two 2×32 kits, not a factory quad — fine at derated
  4-DIMM speeds (~5200); CL28 binning = extra stability margin.
- **Acceptance protocol** (30-day clock starts at delivery — order remaining
  parts NOW so the test rig exists in-window; fallback: torvalds takes the
  same UDIMMs): photograph serials → memtest86 ×4 passes → TM5 anta777 (or
  Karhu) hours-long at final in-case config → one error = return.
- Remaining to order: 9950X ($511 Amazon first-party), ProArt B650-Creator,
  NH-U14S, SN850X 1TB + 2TB, RM850e, NanoKVM-PCIe, case (user picking).
  Projected all-in ≈ **$2,756** of $3,500.

## ALL PARTS ORDERED (2026-07-18, evening)

Final config (PCPartPicker "liskov-final": https://pcpartpicker.com/list/YJ9ZQy):
9950X ($511) · ASUS PRIME B650-PLUS WiFi ($169.95 — ProArt B650-Creator was
EOL/OOS; PRIME-PLUS = CSM-class board w/ FlashBack + 2.5GbE, user likes ASUS
business line) · G.Skill 128GB DDR5-5600 CL28 used ($1,349.97, 30-day
returns) · Samsung 990 Pro 1TB (OS) + 990 Pro 2TB (cache — Samsung chosen
over SN850X at checkout) · NH-U14S ($89.95, plain AM5 SKU) · RM850e ($119) ·
be quiet! Pure Base 501 Airflow ($99.90) · 5× Noctua NF-A14 PWM ($124.75;
layout 2 front in / 2 top out / 1 rear out) · SanDisk 256GB microSD (for
NanoKVM). Amazon orders total $1,994.28 incl tax; all-in ≈ $3,344 + NanoKVM.

Delivery: CPU/PSU/SSDs overnight; fans Sat; cooler Mon; board Fri 7/24;
**case Jul 31–Aug 6 (long pole)**. Plan: bench-build on the board box next
week → FlashBack BIOS → memtest86 ×4 + TM5 on the used RAM well inside its
return window; case arrives later. **Still to order: Sipeed NanoKVM-PCIe.**

Remaining software sequence when built: NanoKVM HDMI check → Talos install
(amd-ucode extension, 105W eco in BIOS, fan curves in BIOS) → tailscale →
Talos worker join → registry pull-through cache consideration → bump Kueue
quota → point Buildkite agent queue at liskov.

## Session Log — 2026-07-18

### Done

- Measured real Buildkite usage over two 30-day windows via REST API
  (scripts in session scratchpad: `bk-usage2.ts`, `bk-duty.ts`, `bk-window2.ts`).
- Costed 7 capacity options (BK hosted, BK enterprise, AWS Elastic CI,
  GCP/Azure, OVH/Hetzner bare metal, used-DDR4 node, new DDR5 node) against
  measured volume.
- Delivered recommendation: Hetzner bare-metal tailnet worker; defer hardware
  purchase until DRAM normalizes.

### Remaining

- No implementation was requested. If pursued next: order box → tailscale →
  Talos worker join → registry pull-through cache for `ci-base` → Kueue quota
  bump.
- Refresh `buildkite-helper` skill (chezmoi source
  `packages/dotfiles/dot_agents/skills/`) — it still documents the
  Dagger/dynamic-pipeline architecture.

### Caveats

- May–June window predates the static pipeline, so its job _count_ (74k) is
  not comparable to the current era; job-hours were consistent across eras
  (~680–850/mo), which is the load-bearing number.
- Cloud prices (spot rates, Hetzner EUR, RAM kits) are July 2026 snapshots;
  re-verify before purchase.
- The 30-day windows were fetched with a 40-page (4,000-build) cap — neither
  window hit it.
