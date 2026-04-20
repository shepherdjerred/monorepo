// Temporal requires workflows to be exported from a single entry point.
// These wrapper functions delegate to the actual workflow implementations
// to satisfy the no-re-exports lint rule.
import { fetchSkillCappedManifest as _fetchSkillCappedManifest } from "./fetcher.ts";
import { generateDependencySummary as _generateDependencySummary } from "./deps-summary.ts";
import { runDnsAudit as _runDnsAudit } from "./dns-audit.ts";
import { syncGolinks as _syncGolinks } from "./golink-sync.ts";
import {
  goodMorningEarly as _goodMorningEarly,
  goodMorningGetUp as _goodMorningGetUp,
  goodMorningWakeUp as _goodMorningWakeUp,
} from "./ha/good-morning.ts";
import { goodNight as _goodNight } from "./ha/good-night.ts";
import { welcomeHome as _welcomeHome } from "./ha/welcome-home.ts";
import { leavingHome as _leavingHome } from "./ha/leaving-home.ts";
import { runVacuumIfNotHome as _runVacuumIfNotHome } from "./ha/run-vacuum-if-not-home.ts";
import { adjustClimate as _adjustClimate } from "./ha/climate-control.ts";

export async function fetchSkillCappedManifest(): Promise<void> {
  return _fetchSkillCappedManifest();
}

export async function generateDependencySummary(daysBack = 7): Promise<void> {
  return _generateDependencySummary(daysBack);
}

export async function runDnsAudit(): Promise<void> {
  return _runDnsAudit();
}

export async function syncGolinks(): Promise<void> {
  return _syncGolinks();
}

export async function goodMorningEarly(): Promise<void> {
  return _goodMorningEarly();
}

export async function goodMorningWakeUp(): Promise<void> {
  return _goodMorningWakeUp();
}

export async function goodMorningGetUp(): Promise<void> {
  return _goodMorningGetUp();
}

export async function goodNight(): Promise<void> {
  return _goodNight();
}

export async function welcomeHome(): Promise<void> {
  return _welcomeHome();
}

export async function leavingHome(): Promise<void> {
  return _leavingHome();
}

export async function runVacuumIfNotHome(): Promise<void> {
  return _runVacuumIfNotHome();
}

export async function adjustClimate(): Promise<void> {
  return _adjustClimate();
}
