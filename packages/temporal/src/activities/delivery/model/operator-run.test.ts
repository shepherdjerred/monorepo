import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import { requireModelRecipe } from "#lib/delivery/model/recipe.ts";
import { artifact, detail, recipe } from "#lib/delivery/model/testing.ts";
import { awaitAttestations } from "./operator-run.ts";

const recorded: {
  key: string;
  status: string;
  evidence: EvidenceInput[];
}[] = [];
async function record(
  _current: unknown,
  key: string,
  status: "running" | "succeeded" | "failed",
  receipt: { operationId: string; evidence?: EvidenceInput[] },
) {
  recorded.push({ key, status, evidence: receipt.evidence ?? [] });
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

function attested(stages: { key: string; status: "running" | "succeeded" }[]) {
  const current = detail(operatorRun, chart, stages);
  const value = requireModelRecipe(current);
  if (value.kind !== "operator-run") throw new Error("Expected operator-run");
  return { current, value };
}

describe("operator-run step", () => {
  it("records intent once, then waits until every declared stage is attested", async () => {
    const first = attested([{ key: "attest/bootstrap", status: "succeeded" }]);
    expect(
      await awaitAttestations(
        first.current,
        first.value,
        "step-attestation",
        record,
      ),
    ).toEqual({ waiting: true });
    expect(recorded).toEqual([
      { key: "step-attestation", status: "running", evidence: [] },
    ]);
    recorded.splice(0);
    const again = attested([
      { key: "step-attestation", status: "running" },
      { key: "attest/bootstrap", status: "succeeded" },
    ]);
    expect(
      await awaitAttestations(
        again.current,
        again.value,
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
});
