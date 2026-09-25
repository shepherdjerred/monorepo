import { z } from "zod";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import type { OpsCollection } from "./ops-types.ts";

const MachineStatusSchema = z.object({
  node: z.string(),
  metadata: z.object({ id: z.string() }),
  spec: z.object({
    stage: z.string(),
    status: z.object({
      ready: z.boolean(),
      unmetConditions: z
        .array(z.object({ name: z.string(), reason: z.string() }))
        .nullable()
        .optional(),
    }),
  }),
});

const ServiceSchema = z.object({
  node: z.string(),
  metadata: z.object({ id: z.string() }),
  spec: z.object({
    running: z.boolean(),
    healthy: z.boolean(),
    /** Talos reports `unknown` for services without a health check. */
    unknown: z.boolean(),
  }),
});

export type TalosMachineStatus = {
  node: string;
  stage: string;
  ready: boolean;
  unmetConditions: string[];
};

export type TalosService = {
  node: string;
  service: string;
  running: boolean;
  /** `undefined` when the service has no health check. */
  healthy: boolean | undefined;
};

type ScanState = { depth: number; inString: boolean; escaped: boolean };

/** Advance the scanner by one character; returns the new brace depth change. */
function scan(state: ScanState, char: string): -1 | 0 | 1 {
  if (state.inString) {
    if (state.escaped) {
      state.escaped = false;
    } else if (char === "\\") {
      state.escaped = true;
    } else if (char === '"') {
      state.inString = false;
    }
    return 0;
  }
  switch (char) {
    case '"': {
      state.inString = true;
      return 0;
    }
    case "{": {
      return 1;
    }
    case "}": {
      return -1;
    }
    default: {
      return 0;
    }
  }
}

/**
 * Split `talosctl -o json` output, which prints one JSON document per
 * resource back to back rather than a JSON array.
 */
export function splitJsonDocuments(text: string): unknown[] {
  const documents: unknown[] = [];
  const state: ScanState = { depth: 0, inString: false, escaped: false };
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const change = scan(state, text.charAt(index));
    if (change === 1 && state.depth === 0) {
      start = index;
    }
    state.depth += change;
    if (change === -1 && state.depth === 0) {
      documents.push(JSON.parse(text.slice(start, index + 1)));
    }
  }
  if (state.depth !== 0 || state.inString) {
    throw new Error("talosctl output ended inside a JSON document");
  }
  return documents;
}

export function parseMachineStatuses(output: string): TalosMachineStatus[] {
  return splitJsonDocuments(output).map((document) => {
    const status = MachineStatusSchema.parse(document);
    return {
      node: status.node,
      stage: status.spec.stage,
      ready: status.spec.status.ready,
      unmetConditions: (status.spec.status.unmetConditions ?? []).map(
        (condition) => `${condition.name}: ${condition.reason}`,
      ),
    };
  });
}

export function parseServices(output: string): TalosService[] {
  return splitJsonDocuments(output).map((document) => {
    const service = ServiceSchema.parse(document);
    return {
      node: service.node,
      service: service.metadata.id,
      running: service.spec.running,
      healthy: service.spec.unknown ? undefined : service.spec.healthy,
    };
  });
}

function machineSignals(
  machines: readonly TalosMachineStatus[],
): SignalInput[] {
  return machines
    .filter((machine) => !machine.ready || machine.stage !== "running")
    .map((machine) => ({
      id: `talos:machine:${machine.node}`,
      source: "talos",
      section: "platform",
      kind: "talos-machine",
      severity: "error",
      needsMe: false,
      title: `Talos node ${machine.node} is ${machine.ready ? machine.stage : "not ready"}`,
      ...(machine.unmetConditions.length === 0
        ? {}
        : { detail: machine.unmetConditions.join("; ") }),
      attributes: { stage: machine.stage },
    }));
}

function serviceSignals(services: readonly TalosService[]): SignalInput[] {
  return services
    .filter((service) => !service.running || service.healthy === false)
    .map((service) => ({
      id: `talos:service:${service.node}:${service.service}`,
      source: "talos",
      section: "platform",
      kind: "talos-service",
      severity: service.running ? "warning" : "error",
      needsMe: false,
      title: `Talos service ${service.service} on ${service.node} is ${service.running ? "unhealthy" : "not running"}`,
      attributes: { node: service.node, service: service.service },
    }));
}

export function mapTalos(
  machines: readonly TalosMachineStatus[],
  services: readonly TalosService[],
): OpsCollection {
  if (machines.length === 0) {
    throw new Error("talosctl returned no machine status");
  }
  return {
    signals: [...machineSignals(machines), ...serviceSignals(services)],
    metrics: [],
    changes: [],
  };
}
