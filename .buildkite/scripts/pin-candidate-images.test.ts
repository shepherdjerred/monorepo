import { expect, test } from "vitest";
import { pinCandidatesForDigests } from "./pin-candidate-images.ts";

function versionCatalogSource(
  entries: readonly { readonly name: string; readonly value: string }[],
): string {
  return JSON.stringify({
    entries: entries.map((entry) => ({
      name: entry.name,
      category: "internal-image",
      artifactType: "image",
      management: { managed: false },
      value: entry.value,
    })),
  });
}

test("publishes a central Workflow candidate without changing stable", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const workflowPin = `2.0.0-12300@sha256:${"c".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      {
        "shepherdjerred/temporal-worker": digest,
        "shepherdjerred/other": digest,
      },
      "42",
      versionCatalogSource([
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: workflowPin,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: workflowPin,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": { version: "2.0.0-42", digest },
    "shepherdjerred/temporal-worker/workflows/candidate": {
      version: "2.0.0-42",
      digest,
    },
    "shepherdjerred/other": { version: "2.0.0-42", digest },
  });
});

test("does not publish a Workflow pin while stable and candidate diverge", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/temporal-worker": digest },
      "44",
      versionCatalogSource([
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: `2.0.0-12300@sha256:${"b".repeat(64)}`,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: `2.0.0-12301@sha256:${"c".repeat(64)}`,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": { version: "2.0.0-44", digest },
  });
});

test("bootstraps stable and candidate before the first central Workflow rollout", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const legacy = `2.0.0-12197@sha256:${"b".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/temporal-worker": digest },
      "42",
      versionCatalogSource([
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: legacy,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: legacy,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": { version: "2.0.0-42", digest },
    "shepherdjerred/temporal-worker/workflows/stable": {
      version: "2.0.0-42",
      digest,
    },
    "shepherdjerred/temporal-worker/workflows/candidate": {
      version: "2.0.0-42",
      digest,
    },
  });
});

test("publishes a central Workflow candidate after stable bootstrap", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/temporal-worker": digest },
      "43",
      versionCatalogSource([
        {
          name: "shepherdjerred/temporal-worker/workflows/stable",
          value: `2.0.0-12300@sha256:${"b".repeat(64)}`,
        },
        {
          name: "shepherdjerred/temporal-worker/workflows/candidate",
          value: `2.0.0-12197@sha256:${"c".repeat(64)}`,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/temporal-worker": { version: "2.0.0-43", digest },
    "shepherdjerred/temporal-worker/workflows/candidate": {
      version: "2.0.0-43",
      digest,
    },
  });
});

test("bootstraps stable and candidate before the first Scout beta rollout", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const legacy = `2.0.0-12197@sha256:${"b".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/scout-for-lol/beta": digest },
      "42",
      versionCatalogSource([
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
          value: legacy,
        },
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
          value: legacy,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/scout-for-lol/beta": { version: "2.0.0-42", digest },
    "shepherdjerred/scout-for-lol/beta/workflows/stable": {
      version: "2.0.0-42",
      digest,
    },
    "shepherdjerred/scout-for-lol/beta/workflows/candidate": {
      version: "2.0.0-42",
      digest,
    },
  });
});

test("publishes only a Scout beta candidate after stable bootstrap", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const legacy = `2.0.0-12197@sha256:${"b".repeat(64)}`;
  const stable = `2.0.0-12300@sha256:${"c".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/scout-for-lol/beta": digest },
      "43",
      versionCatalogSource([
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
          value: stable,
        },
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
          value: legacy,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/scout-for-lol/beta": { version: "2.0.0-43", digest },
    "shepherdjerred/scout-for-lol/beta/workflows/candidate": {
      version: "2.0.0-43",
      digest,
    },
  });
});

test("does not publish a Scout beta pin while tracks diverge", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  expect(
    pinCandidatesForDigests(
      { "shepherdjerred/scout-for-lol/beta": digest },
      "44",
      versionCatalogSource([
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
          value: `2.0.0-12300@sha256:${"b".repeat(64)}`,
        },
        {
          name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
          value: `2.0.0-12301@sha256:${"c".repeat(64)}`,
        },
      ]),
    ),
  ).toEqual({
    "shepherdjerred/scout-for-lol/beta": { version: "2.0.0-44", digest },
  });
});
