---
id: log-2026-07-19-ha-utility-price-tracking
type: log
status: complete
board: false
---

# Home Assistant — Electricity & Water Price Tracking (Seattle Rates)

## Context

Question: does HA track/show electricity and water prices, and are the rates correct for Seattle proper?

## Findings (before)

- **Water**: Energy dashboard water source (`sensor.flume_sensor_meta_house_current_day`, Flume meter) had a static price of **$2.11/m³** — exactly SPU's 2026 peak-season tier-1 _water-only_ rate ($5.98/CCF), but missing the sewer charge ($20.18/CCF, 2026) which is billed on the same metered CCF and is ~3.4× the water charge. The `sensor.flume_sensor_meta_house_current_day_cost` ("Water Cost Today") entity is auto-created by the `energy` integration from that price.
- **Electricity**: grid source (`sensor.meta_house_energy_today`, whole-house meter) had **no price configured** — zero electricity cost tracked (~$56/month untracked at current usage).
- **Mysa** floor-heat thermostats expose `*_electricity_rate` sensors ($/kWh), all `unknown` because no rate is set in the Mysa account.
- TRMNL dashboard only shows presence/security/climate entities — no energy/price display outside HA itself.

## Rates (2026, inside Seattle)

| Component                           | $/CCF  | $/m³    |
| ----------------------------------- | ------ | ------- |
| Water off-peak (Sep 16 – May 15)    | $5.82  | $2.0553 |
| Water peak tier 1 (May 16 – Sep 15) | $5.98  | $2.1118 |
| Sewer (per metered CCF)             | $20.18 | $7.1265 |
| Water peak T1 + sewer               | $26.16 | $9.2383 |
| Water off-peak + sewer              | $26.00 | $9.1818 |

Seattle City Light residential flat rate: **$0.1338/kWh** + $0.3945/day base (TOU alternative: $0.1610 peak / $0.1409 mid / $0.0805 off-peak). Usage ~1.55 CCF/month water → always tier 1, tiers ignored.

Sources: [SPU residential water rates](https://www.seattle.gov/utilities/your-services/accounts-and-payments/rates/water/residential-water-rates), [SPU sewer rates](https://www.seattle.gov/utilities/your-services/accounts-and-payments/rates/sewer), [SCL residential rates](https://www.seattle.gov/city-light/residential-services/billing-information/rates).

## Changes (applied live via HA API, 2026-07-19)

1. Created UI template helper **`sensor.seattle_water_sewer_price`** (unit `USD/m³`) via config-entries flow. State template computes `(water + sewer) / 2.8316846592` and flips seasonally: water = $5.98/CCF during May 16 – Sep 15, $5.82/CCF otherwise; sewer = $20.18/CCF year-round. Currently reads 9.2383.
2. `energy/save_prefs`: water source now uses `entity_energy_price: sensor.seattle_water_sewer_price` (was static 2.11); grid source now has `number_energy_price: 0.1338`.
3. Verified: `energy/validate` clean; `sensor.meta_house_energy_today_cost` auto-created (hidden by default, recorded in long-term stats); water cost sensor accruing at the new rate.

Historical cost stats are **not** recomputed — new rates apply to consumption going forward.

## Not an option / user actions

- **SCL Opower integration** (core `scl`, would pull actual billed usage+cost) is not usable: renter, no SCL account access — hence the static $0.1338/kWh.
- **Mysa**: rate must be set in the Mysa app (Electricity Rate → 0.1338 $/kWh); the HA integration also offers a "Custom Electricity Rate ($/kWh)" override in its config-entry options.

## Rate refresh — January

SPU/SCL rates change Jan 1 (sewer $19.21→$20.18 in 2026; SCL flat rate revised annually). To update: edit the two CCF constants in the `sensor.seattle_water_sewer_price` template (Settings → Devices & Services → Helpers) and the grid `number_energy_price` via the Energy dashboard settings.

<!-- temporal-agent-task
{
  "title": "Refresh HA Seattle utility rates for new year",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2027-01-05T09:00:00-08:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/logs/2026-07-19_ha-utility-price-tracking.md"
  },
  "prompt": "Check seattle.gov for the 2027 SPU residential water rate, SPU sewer rate ($/CCF), and Seattle City Light residential flat rate ($/kWh). Compare against the values in this doc (water peak $5.98 / off-peak $5.82, sewer $20.18 per CCF; electricity $0.1338/kWh) that are configured in Home Assistant (sensor.seattle_water_sewer_price template + energy prefs grid price). Email which values changed and what the new HA numbers should be."
}
-->

## Session Log — 2026-07-19

### Done

- Audited HA energy config via `/api/states` + `energy/get_prefs`/`energy/validate` (854 entities; water price was $2.11/m³ static, grid price unset).
- Researched HA Energy dashboard cost mechanics + Seattle 2026 utility rates.
- Created `sensor.seattle_water_sewer_price` seasonal template helper; set water source to use it; set grid price $0.1338/kWh. Validation clean, cost sensors verified live.

### Remaining

- User: set Electricity Rate = 0.1338 $/kWh in the Mysa app (or the integration's custom-rate option) to populate the Mysa rate sensors.
- Operator (optional): schedule the January rate-refresh temporal task above (`cd packages/temporal && TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/logs/2026-07-19_ha-utility-price-tracking.md`).

### Caveats

- Grid price is marginal only — SCL's $0.3945/day base charge isn't representable in the Energy dashboard.
- Rates are 2026 numbers; both utilities revise Jan 1 (see refresh section).
- The template flips at midnight May 16 / Sep 16 via `now()`; tier-2/3 peak water pricing is ignored (usage ~1.55 CCF/month, tier 1 only).
- HA changes were made with the `trmnl-dashboard-credentials` HA token (it has admin rights).
