import { z } from "zod";
import { fileURLToPath } from "node:url";

export const AdmissionManifestSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
});

const Manifest = AdmissionManifestSchema;

export async function loadAdmissionFixtures(
  execute: (command: string[]) => Promise<string>,
) {
  // Obtain candidate, source reader, copy reader, writer and Velero specs from the
  // actual producer; only its Kubernetes transport and journal persistence are stubbed.
  const producer = fileURLToPath(
    new URL("../../../../../the-storm/server/", import.meta.url),
  );
  const fixtureCode = `
  import json
  import sys
  from pathlib import Path
  from unittest.mock import patch
  sys.path.insert(0,sys.argv[1])
  import delivery_candidate
  import delivery_validation
  from restoration_json import JsonObject
  c = delivery_validation.load_control()
  c.RESTORED_NAMESPACE = c.DELIVERY_VALIDATION_NAMESPACE
  j = JsonObject({
      "requestId": "6903b19f-f4d2-42a5-91ba-6ce046562c83",
      "candidateImage": "docker.io/shepherdjerred/the-storm-server:candidate@sha256:" + "a" * 64,
      "rollbackImage": "docker.io/shepherdjerred/the-storm-server:accepted@sha256:" + "b" * 64,
      "claimUid": "source-claim",
  })
  captured=[]
  def ensure(value):
      result=JsonObject.require(value); captured.append(result)
      result.object("metadata")["uid"]="fixture-uid"
      if result["kind"]=="Backup": result["status"]={"phase":"Completed","volumeSnapshotsAttempted":1,"volumeSnapshotsCompleted":1,"completionTimestamp":"2026-10-17T20:00:00Z"}
      return result
  with patch.object(c,"require_offline"),patch.object(c,"save"),patch.object(c,"ensure_resource",side_effect=ensure),patch.object(c,"run",return_value=json.dumps({"items":[{"metadata":{"name":c.CLAIM,"uid":"source-claim"}}]})):
      c.restore_backup(Path("unused"),j)
  print(json.dumps({"candidate":delivery_candidate.pod_manifest(c,j),"sourceReader":c.reader_manifest(j,c.NAMESPACE),"copyReader":c.reader_manifest(j,c.RESTORED_NAMESPACE),"writer":c.writer_manifest(j),"backup":next(v for v in captured if v["kind"]=="Backup"),"restore":next(v for v in captured if v["kind"]=="Restore")}))
  `;
  const fixtures = z
    .object({
      candidate: Manifest,
      sourceReader: Manifest,
      copyReader: Manifest,
      writer: Manifest,
      backup: Manifest,
      restore: Manifest,
    })
    .parse(JSON.parse(await execute(["python3", "-c", fixtureCode, producer])));
  // Captured fake response metadata/status must not enter create requests.
  for (const fixture of [fixtures.backup, fixtures.restore]) {
    Reflect.deleteProperty(fixture.metadata, "uid");
    Reflect.deleteProperty(fixture, "status");
  }

  return fixtures;
}
