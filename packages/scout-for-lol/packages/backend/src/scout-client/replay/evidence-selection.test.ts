import { expect, test } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import { replayProvenanceFromMatch } from "./provenance.ts";
import {
  selectReplayEvidence,
  type ReplayEvidence,
} from "./evidence-selection.ts";

const match = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const provenance = replayProvenanceFromMatch(
  match,
  match.metadata.participants,
);
if (provenance === null) throw new Error("Replay fixture has no participants");
const client: ReplayEvidence = {
  platformId: "NA1",
  authority: "observed",
  provenance,
};

test("a bare replay game ID cannot choose between platforms", () => {
  const european = { ...client, platformId: "EUW1" };
  expect(selectReplayEvidence([client, european], null)).toBeNull();
  expect(selectReplayEvidence([client, european], "euw1")).toMatchObject({
    platformId: "EUW1",
  });
});

test("archives pin the fingerprint and equal-authority contradictions wait", () => {
  const contradictory = {
    ...client,
    provenance: {
      ...client.provenance,
      gameDurationSeconds: client.provenance.gameDurationSeconds + 30,
    },
  };
  expect(selectReplayEvidence([client, contradictory], null)).toBeNull();
  expect(
    selectReplayEvidence(
      [contradictory, { ...client, authority: "archived" }],
      null,
    ),
  ).toEqual({ ...client.provenance, platformId: "NA1" });
});
