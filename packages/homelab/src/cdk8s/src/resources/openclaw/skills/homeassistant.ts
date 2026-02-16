export const homeassistantSkill = `---
name: homeassistant
description: Control Home Assistant smart home devices
metadata:
  openclaw:
    requires:
      env: ["HOMEASSISTANT_TOKEN"]
---
# Home Assistant

Use curl to control Home Assistant at http://homeassistant-service.home.svc:8123

## Authentication
Authorization: Bearer $HOMEASSISTANT_TOKEN

## Common Operations
- List entities: GET /api/states
- Get entity state: GET /api/states/{entity_id}
- Call service: POST /api/services/{domain}/{service}
- Turn on light: POST /api/services/light/turn_on {"entity_id": "light.xxx"}
`;
