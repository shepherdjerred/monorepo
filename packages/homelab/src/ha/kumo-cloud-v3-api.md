# Kumo Cloud v3 API — Complete Surface (Decompiled from APK v3.2.4)

Reverse-engineered from the "Comfort by Mitsubishi Electric" Android app (com.mehvac.kumocloud v3.2.4).
The app is React Native with Hermes bytecode. 232,319 strings extracted via P1sec/hermes-dec.

## Base URLs

| Environment | REST API                             | Socket.IO                            | BLE                        |
| ----------- | ------------------------------------ | ------------------------------------ | -------------------------- |
| Production  | `https://app-prod.kumocloud.com/v3/` | `https://socket-prod.kumocloud.com/` | —                          |
| Staging     | `https://app-stg.kumocloud.com/v3/`  | `https://socket-stg.kumocloud.com/`  | `blewit-stg.kumocloud.com` |
| Dev         | `https://app-dev.kumocloud.com/v3/`  | `https://socket-dev.kumocloud.com/`  | `blewit-dev.kumocloud.com` |
| Status      | `https://status-api.kumocloud.com/`  | —                                    | —                          |

## Auth

| Endpoint          | Notes       |
| ----------------- | ----------- |
| `/login`          |             |
| `/logout`         |             |
| `/refresh`        | JWT refresh |
| `/exchange-token` |             |
| `/generate-hash`  |             |

## Accounts

| Endpoint                            | Notes                                 |
| ----------------------------------- | ------------------------------------- |
| `/accounts`                         |                                       |
| `/accounts/me`                      | Current user                          |
| `/accounts/delete`                  |                                       |
| `/accounts/fcm`                     | Firebase Cloud Messaging registration |
| `/accounts/fcm/delete`              |                                       |
| `/accounts/forgot-password`         |                                       |
| `/accounts/pin-info`                |                                       |
| `/accounts/preferences`             |                                       |
| `/accounts/reset-password`          |                                       |
| `/accounts/revert-hijack`           |                                       |
| `/accounts/send-verification-email` |                                       |
| `/accounts/update-password`         |                                       |
| `/accounts/update-username`         |                                       |
| `/accounts/validate-reset-code`     |                                       |
| `/accounts/verify-email`            |                                       |

## Sites

| Endpoint                           | Notes                          |
| ---------------------------------- | ------------------------------ |
| `/sites`                           | List all sites                 |
| `/sites/{id}`                      | Site details                   |
| `/sites/{id}/groups`               | Groups within site             |
| `/sites/{id}/kumo-station`         | Kumo Station devices           |
| `/sites/{id}/toggle-notifications` |                                |
| `/sites/{id}/toggle-schedules`     |                                |
| `/sites/{id}/weather`              | Weather data for site location |
| `/sites/{id}/zones`                | Zones within site              |
| `/sites/transfers/{id}/cancel`     | Site ownership transfer        |
| `/sites/transfers/{id}/confirm`    |                                |
| `/sites/transfers/{id}/resend`     |                                |
| `/sites/transfers/pending`         |                                |
| `/site/{id}/preferable-contractor` |                                |
| `/site/{id}/request-service`       |                                |

## Zones

| Endpoint                               | Notes                                  |
| -------------------------------------- | -------------------------------------- |
| `/zones`                               |                                        |
| `/zones/{id}`                          | Zone details                           |
| `/zones/{id}/comfort-settings`         |                                        |
| `/zones/{id}/connection-history`       | WiFi connectivity history (not energy) |
| `/zones/{id}/notification-preferences` |                                        |
| `/zones/{id}/reset-filter`             |                                        |
| `/zones/{id}/schedules`                |                                        |
| `/zones/{id}/switch-schedule`          |                                        |

## Devices

| Endpoint                             | Notes                                 |
| ------------------------------------ | ------------------------------------- |
| `/devices`                           |                                       |
| `/devices/{serial}`                  |                                       |
| `/devices/{serial}/acoil-settings`   | A-coil / air handler settings         |
| `/devices/{serial}/auto-dry`         | Humidity-based auto-dry               |
| `/devices/{serial}/ble-reset`        | BLE adapter reset                     |
| `/devices/{serial}/initial-settings` |                                       |
| `/devices/{serial}/kumo-properties`  |                                       |
| `/devices/{serial}/mhk2`             | MHK2 thermostat integration           |
| `/devices/{serial}/profile`          | Device capabilities                   |
| `/devices/{serial}/prohibits`        | Locked/prohibited settings            |
| `/devices/{serial}/recent-connected` |                                       |
| `/devices/{serial}/sensor`           |                                       |
| `/devices/{serial}/sensor-sensors`   |                                       |
| `/devices/{serial}/status`           | Current state (temp, mode, fan, etc.) |
| `/devices/claim`                     | Onboarding                            |
| `/devices/config-key`                |                                       |
| `/devices/send-command`              | Control commands                      |
| `/devices/unregister`                |                                       |
| `/devices/verify`                    |                                       |

## Groups

| Endpoint                          | Notes                                 |
| --------------------------------- | ------------------------------------- |
| `/groups`                         |                                       |
| `/groups/{id}`                    |                                       |
| `/groups/{id}/add-zones`          |                                       |
| `/groups/{id}/changeover`         | Heat pump/furnace changeover settings |
| `/groups/{id}/ungroup`            |                                       |
| `/groups/{groupId}/zone/{zoneId}` |                                       |

## Kumo Station

| Endpoint                                       | Notes |
| ---------------------------------------------- | ----- |
| `/kumo-station`                                |       |
| `/kumo-station/{id}/accessory`                 |       |
| `/kumo-station/{id}/accessory/{channelNumber}` |       |

## Other

| Endpoint                      | Notes            |
| ----------------------------- | ---------------- |
| `/address-autocomplete`       |                  |
| `/attach-user-device`         |                  |
| `/attached-devices`           |                  |
| `/available-devices`          |                  |
| `/comfort-settings`           |                  |
| `/comfort-settings/presets`   |                  |
| `/contractors`                |                  |
| `/notifications`              |                  |
| `/notifications/seen`         |                  |
| `/notifications/unseen-count` |                  |
| `/onboarding`                 |                  |
| `/schedule/{id}`              |                  |
| `/schedule/{id}/duplicate`    |                  |
| `/sensors`                    | Wireless sensors |
| `/sensors/{id}`               |                  |

## Socket.IO Events

| Event              | Description                     |
| ------------------ | ------------------------------- |
| `device_status_v2` | Real-time device status updates |
| `device_update`    | Device configuration changes    |
| `acoil_update`     | A-coil settings changes         |
| `prohibits_update` | Prohibit settings changes       |

## AsyncStorage Keys

- `KUMOCLOUD_creds` — Stored credentials
- `KUMOCLOUD_session` — Session data
- `KUMOCLOUD_emailIsVerified`
- `KUMOCLOUD_preferences`
- `KUMOCLOUD_requestError`
- `KUMOCLOUD_rootGroups`
- `KUMOCLOUD_siteDetails`
- `KUMOCLOUD_userDetails`

## Device Status Fields

From string analysis, the device status includes:

- `roomTemp` / `roomTempA` — Indoor temperature
- `setTemp` / `setTempA` — Set point
- `outdoorTemp` — Outdoor temperature (if sensor available)
- `humidity` / `currentHumidity` — Indoor humidity
- `filterDirty` — Filter maintenance flag
- `defrost` — Defrost mode active
- `standby` — Standby mode
- `power` / `PowerMode` — Power on/off state

## Energy Usage Analysis: NOT AVAILABLE

After exhaustive analysis of all 232,319 strings in the Hermes bytecode:

**There are ZERO energy usage, analytics, or reporting endpoints in the Kumo Cloud v3 API.**

The word "energy" only appears in these contexts:

1. **"Energy Savings"** — A device feature that cycles the compressor to save energy (on/off toggle)
2. **"efficiency" / "efficiencyMEUS"** — Static MEUS efficiency rating
3. **UI copy** — "increase your energy consumption" / "reduce energy usage" (humidity slider labels)

The word "consumption" appears once, isolated — not part of any API path or data model.

**No strings found for:**

- kWh / kilowatt-hour tracking
- Energy charts or graphs
- Usage history or reporting
- Runtime hour accumulation
- Power consumption monitoring
- Operating cost estimation

### Why Other Reverse Engineers Found Nothing

The comfort_HA and homebridge-mitsubishi-comfort projects were correct: **these endpoints don't exist**.
The Kumo Cloud platform simply does not track or report energy usage data.

### If You See Energy Charts in the App

If the Mitsubishi Comfort app displays energy charts, they are most likely:

1. **Client-side estimations** — Calculated from on/off state transitions + rated wattage (no API needed)
2. **MHK2-specific** — The MHK2 thermostat has its own data, accessible via `/devices/{serial}/mhk2`
3. **From a different product line** — CITY MULTI or commercial systems may have separate APIs
4. **A different app** — The older "kumo cloud" app (lowercase) vs the newer "Comfort" app

### Implications for Home Assistant Integration

Since no energy endpoints exist, energy tracking for HA must be done via:

- **Power monitoring** — Use a smart plug (e.g., Shelly Plug S, TP-Link Kasa) to measure actual consumption
- **Runtime estimation** — Track mode/power state changes from `/devices/{serial}/status` or `device_status_v2` socket events, multiply by rated wattage
- **Integration with utility provider** — Some utilities provide API access to smart meter data
