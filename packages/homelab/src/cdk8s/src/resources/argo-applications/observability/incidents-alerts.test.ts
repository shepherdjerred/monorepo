import {
  INCIDENT_ALERTMANAGER_PATH as PACKAGE_PATH,
  INCIDENT_ALERTNAMES as PACKAGE_ALERTNAMES,
  INCIDENT_ALERT_RECEIVER as PACKAGE_RECEIVER,
} from "@shepherdjerred/incidents/alert-rules";
import { describe, expect, it } from "vitest";
import {
  INCIDENT_ALERTMANAGER_PATH,
  INCIDENT_ALERTNAMES,
  INCIDENT_ALERT_RECEIVER,
  INCIDENTS_ROUTE,
} from "./incidents-alerts.ts";

describe("Incidents Alertmanager route", () => {
  it("matches the Incidents package's curated alert rules exactly", () => {
    expect([...INCIDENT_ALERTNAMES]).toEqual([...PACKAGE_ALERTNAMES]);
    expect(INCIDENT_ALERT_RECEIVER).toBe(PACKAGE_RECEIVER);
    expect(INCIDENT_ALERTMANAGER_PATH).toBe(PACKAGE_PATH);
  });

  it("routes every curated alertname and nothing else", () => {
    expect(INCIDENTS_ROUTE.matchers).toEqual([
      `alertname =~ "${PACKAGE_ALERTNAMES.join("|")}"`,
    ]);
    expect(INCIDENTS_ROUTE.continue).toBe(true);
  });
});
