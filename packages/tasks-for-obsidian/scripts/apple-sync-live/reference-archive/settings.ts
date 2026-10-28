import { z } from "zod";

const object = z.record(z.string(), z.unknown());
function emptyObject(value: unknown) {
  if (value === undefined) return true;
  const parsed = object.safeParse(value);
  return parsed.success && Object.keys(parsed.data).length === 0;
}
function nestedOff(value: unknown, key: string) {
  if (value === undefined) return true;
  const parsed = object.safeParse(value);
  return (
    parsed.success &&
    (parsed.data[key] === undefined || parsed.data[key] === false)
  );
}

/** Rechecks the pinned TaskNotes 4.13.8 saved-data contract; never sanitizes it. */
export function assertCredentialFreeSettings(bytes: Uint8Array) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Reference archive settings JSON is invalid");
  }
  const data = object.parse(value);
  const flagsOff = [
    "enableAPI",
    "enableMCP",
    "enableGoogleCalendar",
    "enableMicrosoftCalendar",
  ].every((key) => data[key] === undefined || data[key] === false);
  const stringsEmpty = [
    "apiAuthToken",
    "googleOAuthClientId",
    "googleOAuthClientSecret",
    "microsoftOAuthClientId",
    "microsoftOAuthClientSecret",
  ].every((key) => data[key] === undefined || data[key] === "");
  const arraysEmpty = [
    "webhooks",
    "icsSubscriptions",
    "enabledGoogleCalendars",
    "enabledMicrosoftCalendars",
  ].every(
    (key) =>
      data[key] === undefined ||
      (Array.isArray(data[key]) && data[key].length === 0),
  );
  const storesEmpty = [
    "googleCalendarSyncTokens",
    "microsoftCalendarSyncTokens",
    "oauthConnections",
  ].every((key) => emptyObject(data[key]));
  if (
    !flagsOff ||
    !stringsEmpty ||
    !arraysEmpty ||
    !storesEmpty ||
    !nestedOff(data["googleCalendarExport"], "enabled") ||
    !nestedOff(data["icsIntegration"], "enableAutoExport")
  )
    throw new Error(
      "Reference archive contains enabled integrations or credential-bearing settings",
    );
}
