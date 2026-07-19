# Handoff: Home Assistant Utility Price Tracking (Seattle)

## Status

Complete — operational; two small user-side items outstanding (see Outstanding).

Session journal: `packages/docs/logs/2026-07-19_ha-utility-price-tracking.md`.

## What exists now

Home Assistant's Energy dashboard tracks **both** electricity and water cost:

| Piece            | Value                                                                                  | Where it lives                                         |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Water usage stat | `sensor.flume_sensor_meta_house_current_day` (Flume, liters)                           | Flume integration                                      |
| Water price      | `sensor.seattle_water_sewer_price` — template helper, `USD/m³`, seasonal               | HA UI helper (Settings → Devices & Services → Helpers) |
| Water cost       | `sensor.flume_sensor_meta_house_current_day_cost` ("Water Cost Today")                 | auto-created by the `energy` integration               |
| Grid usage stat  | `sensor.meta_house_energy_today` (whole-house meter)                                   | existing                                               |
| Grid price       | static `number_energy_price: 0.1338` $/kWh                                             | energy prefs                                           |
| Grid cost        | `sensor.meta_house_energy_today_cost` (hidden by default, recorded in long-term stats) | auto-created by the `energy` integration               |

The water price template computes `(water_per_ccf + sewer_per_ccf) / 2.8316846592` (m³ per CCF) and flips seasonally on SPU's boundaries:

- **Peak** May 16 – Sep 15: water $5.98/CCF → **$9.2383/m³** combined
- **Off-peak** Sep 16 – May 15: water $5.82/CCF → **$9.1818/m³** combined
- Sewer $20.18/CCF year-round (2026). Tier 2/3 peak water rates are deliberately ignored — usage is ~1.55 CCF/month, always tier 1.

All configuration is HA-side (UI helper + server-side energy prefs). **Nothing in this repo drives it**; this doc and the log are the only records.

## Access / how to inspect or change

- HA base URL: `https://homeassistant.tailnet-1a49.ts.net` (Tailscale) — in-cluster it's `http://homeassistant-service.home:8123`.
- Admin long-lived token: 1Password item `trmnl-dashboard-credentials` (vault `v64ocnykdqju4ui6j6pua56xw4`), field `HA_TOKEN`. Batch `op` calls — each needs biometric approval.
- Energy prefs: WebSocket API only (no REST) — `energy/get_prefs`, `energy/save_prefs` (admin, partial update by top-level key), `energy/validate`. Auth flow: wait for `auth_required`, send `{type: "auth", access_token}`, then send commands with incrementing `id`.
- Template helper: edit in the HA UI, or via REST config-entries flow (`POST /api/config/config_entries/flow` with `handler: "template"` → `next_step_id: "sensor"` → `{name, state, unit_of_measurement}`).
- Price semantics: HA converts the usage stat to m³ and multiplies by the price entity's state; cost accrues incrementally (`old + delta × current_price`). Changing the price never recomputes history.

## Annual rate refresh (every January)

1. Get new rates (verify liveness before writing them anywhere):
   - Water: <https://www.seattle.gov/utilities/your-services/accounts-and-payments/rates/water/residential-water-rates> (off-peak + peak tier-1, inside Seattle, $/CCF)
   - Sewer: <https://www.seattle.gov/utilities/your-services/accounts-and-payments/rates/sewer> ($/CCF)
   - Electricity: <https://www.seattle.gov/city-light/residential-services/billing-information/rates> (flat rate, Seattle column, $/kWh)
2. Edit the three constants at the top of the `sensor.seattle_water_sewer_price` template (`water_peak_ccf`, `water_offpeak_ccf`, `sewer_ccf`).
3. Update the grid price: Energy dashboard settings UI, or `energy/save_prefs` with the grid source's `number_energy_price`.
4. The log doc contains a `temporal-agent-task` block (runAt 2027-01-05) that emails a comparison report — schedule it with `cd packages/temporal && TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/logs/2026-07-19_ha-utility-price-tracking.md` (not yet scheduled).

## Outstanding

- **Mysa rate** (user action): Mysa thermostats' `*_electricity_rate` sensors read `unknown` until the Electricity Rate (0.1338 $/kWh) is set in the Mysa app (preferred — also enables Mysa's in-app cost charting) or via the Mysa integration's "Custom Electricity Rate" option in HA.
- **Temporal reminder not scheduled** (operator action): step 4 above.
- **TOU verification**: the $0.1338 flat rate assumes SCL's standard plan. If a bill shows Time-of-Use pricing, replace the grid static price with a TOU template entity (peak $0.1610 5–9pm Mon–Sat / mid $0.1409 / off-peak $0.0805 midnight–6am, 2026 values) using the same template-helper approach as water.

## Constraints & context

- **No SCL account access** (renter; landlord holds the account), so the core `scl` Opower integration — which would pull actual billed usage and cost — is not an option. Static/marginal pricing is the ceiling here.
- SCL's $0.3945/day base service charge is usage-independent and cannot be represented in the Energy dashboard.
- Seattle bills sewer on the same metered CCF as water; sewer ($20.18/CCF) is ~3.4× the water charge, which is why the combined price matters.
- The TRMNL e-ink dashboard (`packages/trmnl-dashboard`) shows only presence/security/climate entities — it does not surface any of these cost sensors.
