import { expect, test } from "vitest";
import { collectMacProbeEvidence } from "./probe-collection";

const sessionID = "7c94e51d-5c49-4a3b-ae5e-f94392f8caed";
const prepared = {
  input: { sessionID },
  evidenceDirectory: "/private/tmp/owned-probe/evidence",
};
const file = "account-input/sessions/" + sessionID + "/capture.json";
const guestFiles = { [file]: new TextEncoder().encode("public-fixture") };
function receipt() {
  return {
    kind: "mac-input-collected",
    sessionID,
    evidenceDirectory: prepared.evidenceDirectory,
    files: [file],
    passed: true,
    failure: "none",
  };
}

test.each([
  "guest-request",
  "receipt",
  "correlation",
  "readback",
  "inventory",
] as const)(
  "failed collection records only its closed %s stage",
  async (stage) => {
    const privateError = "must-not-retain-this-exception-payload";
    const result = await collectMacProbeEvidence({
      prepared,
      request: () => {
        if (stage === "guest-request")
          return Promise.reject(new Error(privateError));
        if (stage === "receipt") return Promise.resolve({ privateError });
        const value = receipt();
        if (stage === "correlation") value.sessionID = crypto.randomUUID();
        return Promise.resolve(value);
      },
      readFiles: () => {
        if (stage === "readback")
          return Promise.reject(new Error(privateError));
        if (stage === "inventory")
          return Promise.resolve({
            ...guestFiles,
            unexpected: new Uint8Array(),
          });
        throw new Error("An earlier rejected stage must stop readback");
      },
    });
    expect(result.guestCollectionPassed).toBe(false);
    expect(result.failure).toEqual({
      classification: "owned-output-collection-incomplete",
      collectionStage: stage,
    });
    expect(JSON.stringify(result.failure)).not.toContain(privateError);
    if (stage === "inventory") {
      // Received files remain available to the original scanner after validation fails.
      expect(Object.keys(result.guestFiles).sort()).toEqual(
        [file, "unexpected"].sort(),
      );
    } else expect(result.guestFiles).toEqual({});
  },
);

test.each([true, false])(
  "guest reported passed=%s is preserved after exact readback",
  async (passed) => {
    const result = await collectMacProbeEvidence({
      prepared,
      request: () =>
        Promise.resolve({
          ...receipt(),
          passed,
          failure: passed ? "none" : "capture",
        }),
      readFiles: (files) => {
        expect(files).toEqual([file]);
        return Promise.resolve(guestFiles);
      },
    });
    expect(result).toEqual({
      guestFiles,
      guestCollectionPassed: passed,
      failure: null,
    });
  },
);

test.each([
  { files: [file, file] },
  { files: [file + "/unexpected"] },
  {
    files: ["account-input/sessions/" + crypto.randomUUID() + "/capture.json"],
  },
])(
  "duplicate or unbound file paths cannot reach readback",
  async ({ files }) => {
    const result = await collectMacProbeEvidence({
      prepared,
      request: () => Promise.resolve({ ...receipt(), files }),
      readFiles: () => {
        throw new Error("Rejected inventory cannot be read");
      },
    });
    expect(result.guestCollectionPassed).toBe(false);
    expect(result.failure?.collectionStage).toBe("correlation");
  },
);
