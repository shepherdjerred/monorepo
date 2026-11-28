import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import {
  modelSteps,
  oracleProbes,
  requireModelRecipe,
} from "#lib/delivery/model/recipe.ts";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { awaitAttestations } from "./operator-run.ts";

const recorded: {
  key: string;
  status: string;
  message?: string | undefined;
  evidence: EvidenceInput[];
}[] = [];
async function record(
  _current: unknown,
  key: string,
  status: "running" | "succeeded" | "failed",
  receipt: {
    operationId: string;
    message?: string;
    evidence?: EvidenceInput[];
  },
) {
  recorded.push({
    key,
    status,
    message: receipt.message,
    evidence: receipt.evidence ?? [],
  });
  await Promise.resolve();
}

afterEach(() => {
  recorded.splice(0);
});

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.0.1.tgz",
  version: "1.0.1",
  character: "b",
});
const operatorRun = {
  kind: "operator-run",
  wrapped: recipe(
    { repoURL: "https://chartmuseum.tailnet-1a49.ts.net", chart: "arcade" },
    "chart:arcade",
  ),
  stages: ["bootstrap", "verify"],
};

function attested(
  stages: {
    key: string;
    status: "running" | "succeeded";
    message?: string;
  }[],
) {
  const current = detail(operatorRun, chart, stages);
  for (const [index, stage] of stages.entries()) {
    const entry = current.stages[index];
    if (entry !== undefined && stage.message !== undefined) {
      entry.message = stage.message;
    }
  }
  const value = requireModelRecipe(current);
  if (value.kind !== "operator-run") throw new Error("Expected operator-run");
  return { current, value };
}

describe("operator-run step", () => {
  it("records remaining stage keys and updates the message only when missing stages change", async () => {
    const initial = attested([]);
    expect(
      await awaitAttestations(
        initial.current,
        initial.value,
        "step-attestation",
        record,
      ),
    ).toEqual({ waiting: true });
    expect(recorded).toEqual([
      {
        key: "step-attestation",
        status: "running",
        message: "Awaiting operator attestation (--stage): bootstrap, verify",
        evidence: [],
      },
    ]);
    recorded.splice(0);

    const progressed = attested([
      {
        key: "step-attestation",
        status: "running",
        message: "Awaiting operator attestation (--stage): bootstrap, verify",
      },
      { key: "attest/bootstrap", status: "succeeded" },
    ]);
    expect(
      await awaitAttestations(
        progressed.current,
        progressed.value,
        "step-attestation",
        record,
      ),
    ).toEqual({ waiting: true });
    expect(recorded).toEqual([
      {
        key: "step-attestation",
        status: "running",
        message: "Awaiting operator attestation (--stage): verify",
        evidence: [],
      },
    ]);
    recorded.splice(0);

    const unchanged = attested([
      {
        key: "step-attestation",
        status: "running",
        message: "Awaiting operator attestation (--stage): verify",
      },
      { key: "attest/bootstrap", status: "succeeded" },
    ]);
    expect(
      await awaitAttestations(
        unchanged.current,
        unchanged.value,
        "step-attestation",
        record,
      ),
    ).toEqual({ waiting: true });
    expect(recorded).toEqual([]);
  });

  it("settles the step with attestation evidence when every stage is attested", async () => {
    const done = attested([
      { key: "step-attestation", status: "running" },
      { key: "attest/bootstrap", status: "succeeded" },
      { key: "attest/verify", status: "succeeded" },
    ]);
    expect(
      await awaitAttestations(
        done.current,
        done.value,
        "step-attestation",
        record,
      ),
    ).toEqual({ waiting: false });
    expect(recorded).toEqual([
      {
        key: "step-attestation",
        status: "succeeded",
        evidence: [
          expect.objectContaining({
            kind: "attestation",
            summary:
              "Operator attested every declared stage: bootstrap, verify",
          }),
        ],
      },
    ]);
  });

  it("a standalone host recipe waits on the same attestations and has no probes", async () => {
    const host = {
      kind: "operator-run",
      wrapped: {
        kind: "host",
        instance: "host:liskov",
        components: ["image:installer", "image:kubelet"],
      },
      stages: ["talos-upgrade", "kubernetes-upgrade"],
    };
    const current = detail(host, chart, [
      { key: "attest/talos-upgrade", status: "succeeded" },
    ]);
    const value = requireModelRecipe(current);
    if (value.kind !== "operator-run") throw new Error("Expected operator-run");
    expect(modelSteps(value).map((step) => step.adapter)).toEqual([
      "operator-run",
    ]);
    expect(oracleProbes(value)).toEqual([]);
    expect(
      await awaitAttestations(current, value, "step-attestation", record),
    ).toEqual({ waiting: true });
  });
});
