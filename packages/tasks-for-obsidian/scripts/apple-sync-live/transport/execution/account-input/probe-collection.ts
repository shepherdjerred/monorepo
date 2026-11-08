import assert from "node:assert/strict";
import { MacInputCollectedSchema, type MacInputPrepared } from "./protocol";

type CollectionStage =
  "guest-request" | "receipt" | "correlation" | "readback" | "inventory";
type ProbeCollection = {
  guestFiles: Record<string, Uint8Array>;
  guestCollectionPassed: boolean;
  failure: {
    classification: "owned-output-collection-incomplete";
    collectionStage: CollectionStage;
  } | null;
};

/** Closed stages locate failures without retaining exception text or private values. */
export async function collectMacProbeEvidence(options: {
  prepared: {
    input: Pick<MacInputPrepared["input"], "sessionID">;
    evidenceDirectory: string;
  };
  request: () => Promise<unknown>;
  readFiles: (files: string[]) => Promise<Record<string, Uint8Array>>;
}): Promise<ProbeCollection> {
  let collectionStage: CollectionStage = "guest-request";
  let guestFiles: Record<string, Uint8Array> = {};
  try {
    const receipt = await options.request();
    collectionStage = "receipt";
    const collected = MacInputCollectedSchema.parse(receipt);
    collectionStage = "correlation";
    const { sessionID } = options.prepared.input;
    assert.equal(collected.sessionID, sessionID);
    assert.equal(
      collected.evidenceDirectory,
      options.prepared.evidenceDirectory,
    );
    const prefix = "account-input/sessions/" + sessionID + "/";
    assert.equal(new Set(collected.files).size, collected.files.length);
    assert.ok(
      collected.files.every(
        (file) =>
          file.startsWith(prefix) && !file.slice(prefix.length).includes("/"),
      ),
    );
    collectionStage = "readback";
    guestFiles = await options.readFiles(collected.files);
    collectionStage = "inventory";
    assert.deepEqual(
      Object.keys(guestFiles).sort(),
      [...collected.files].sort(),
    );
    return {
      guestFiles,
      guestCollectionPassed: collected.passed,
      failure: null,
    };
  } catch {
    return {
      guestFiles,
      guestCollectionPassed: false,
      failure: {
        classification: "owned-output-collection-incomplete",
        collectionStage,
      },
    };
  }
}
