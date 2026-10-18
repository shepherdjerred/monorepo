import { expect, test } from "vitest";
import recipe from "@shepherdjerred/ops-model/forum/native-observation.json" with { type: "json" };
import {
  createNativeForumReader,
  forumObservationCommand,
  FORUM_OBSERVER_KUBECONFIG,
} from "./native-reader.ts";

const request = {
  namespace: "storm-forum",
  pod: "storm-forum-web-abc",
  uid: "actual-pod-uid",
};
test("native adoption uses only the fixed readonly PHP command, projected credentials and no shell/stdin/TTY", async () => {
  const command = forumObservationCommand(request);
  expect(command).toEqual([
    "kubectl",
    "--kubeconfig",
    FORUM_OBSERVER_KUBECONFIG,
    "--request-timeout=15s",
    "--namespace",
    "storm-forum",
    "exec",
    request.pod,
    "--container",
    "php",
    "--",
    ...recipe.command,
  ]);
  const status = {
    schemaVersion: 1,
    state: "installed",
    xenforoVersion: "2.3.13",
    bundleSha256: "a".repeat(64),
    maintenance: false,
    releaseLock: false,
  };
  expect(
    await createNativeForumReader((actual) => {
      expect(actual).toEqual(command);
      return Promise.resolve(JSON.stringify(status));
    })(request),
  ).toEqual(status);
});
test.each([
  { ...request, namespace: "kube-system" },
  { ...request, pod: "storm-forum-database-0" },
  { ...request, pod: "storm-forum-web-abc;sh" },
  { ...request, uid: "" },
])("rejects noncanonical native targets", (input) => {
  expect(() => forumObservationCommand(input)).toThrow(/canonical original/u);
});
test("a held native release lock cannot become settled baseline proof", async () => {
  await expect(
    createNativeForumReader(() =>
      Promise.resolve(
        JSON.stringify({
          schemaVersion: 1,
          state: "installed",
          xenforoVersion: "2.3.13",
          bundleSha256: "a".repeat(64),
          maintenance: false,
          releaseLock: true,
        }),
      ),
    )(request),
  ).rejects.toThrow();
});
