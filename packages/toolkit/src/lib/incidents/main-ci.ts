/**
 * The open `main-ci` incident, for `toolkit ci` reports when main is red.
 * Advisory only: a failing lookup becomes a warning line and never changes
 * the CI verdict or exit code.
 */
import type { ActorInput } from "@shepherdjerred/incidents/contract";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { sessionActor } from "#lib/tracker/context.ts";
import { incidentActor, incidentsApi } from "./client.ts";
import {
  commandStateText,
  nextCommand,
  nextStep,
  type IncidentRelation,
} from "./guidance.ts";

export type MainCiIncidentReport =
  | {
      readonly available: true;
      readonly checkedAt: string;
      readonly incident: {
        readonly identifier: string;
        readonly title: string;
        readonly status: string;
        readonly severity: string;
        readonly commandState: string;
        readonly commander: string | null;
        readonly url: string;
      } | null;
      readonly relation: IncidentRelation | null;
      readonly recommended: string;
      readonly guidance: string;
    }
  | {
      readonly available: false;
      readonly checkedAt: string;
      readonly warning: string;
    };

const LOOKUP_TIMEOUT_MS = 3000;
const DECLARE_MAIN_CI =
  'toolkit incident declare --system main-ci --severity sev2 --title "Main CI is red" --exit-condition "Main\'s authoritative CI passes."';

async function configuredHubUrl(): Promise<string> {
  const config = await loadToolkitConfig();
  return config.value("opsDashboardUrl");
}

async function defaultActor(): Promise<ActorInput | undefined> {
  try {
    return incidentActor(await sessionActor({}, await loadToolkitConfig()));
  } catch {
    // Without a session identity the lookup still reports the incident; it only loses the relation.
    return undefined;
  }
}

export async function mainCiIncident(
  options: {
    baseUrl?: string;
    actor?: ActorInput | null;
    timeoutMs?: number;
  } = {},
): Promise<MainCiIncidentReport> {
  const checkedAt = new Date().toISOString();
  try {
    const baseUrl = options.baseUrl ?? (await configuredHubUrl());
    const actor =
      options.actor === undefined
        ? await defaultActor()
        : (options.actor ?? undefined);
    const result = await incidentsApi(
      baseUrl,
      options.timeoutMs ?? LOOKUP_TIMEOUT_MS,
    ).check({ system: "main-ci", ...(actor === undefined ? {} : { actor }) });
    const entry =
      result.incidents.find((item) => item.incident.kind === "incident") ??
      null;
    if (entry === null)
      return {
        available: true,
        checkedAt: result.checkedAt,
        incident: null,
        relation: null,
        recommended: DECLARE_MAIN_CI,
        guidance: `No main-ci incident is open; if nobody is fixing main, declare one: ${DECLARE_MAIN_CI}`,
      };
    const { incident } = entry;
    return {
      available: true,
      checkedAt: result.checkedAt,
      incident: {
        identifier: incident.identifier,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        commandState: incident.command.state,
        commander: incident.command.commander?.key ?? null,
        url: incident.url,
      },
      relation: actor === undefined ? null : entry.relation,
      recommended: nextCommand(entry),
      guidance: `${incident.identifier} ${incident.severity} ${incident.status}: ${incident.title} — ${commandStateText(incident)}. ${nextStep(entry)}`,
    };
  } catch (error) {
    // Never echo a remote body into a credential-bearing CI report.
    return {
      available: false,
      checkedAt,
      warning: `Warning: main-ci incident lookup failed (${error instanceof Error ? error.name : "error"}); run toolkit incident check --system main-ci.`,
    };
  }
}

export function formatMainCiIncident(report: MainCiIncidentReport): string {
  return report.available ? `Incident: ${report.guidance}` : report.warning;
}
