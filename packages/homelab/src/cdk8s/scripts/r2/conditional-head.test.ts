import { expect, test } from "vitest";
import { verifyConditionalHead } from "./conditional-head.ts";

function probe(head: (etag: string) => Promise<void>) {
  const removed: string[] = [];
  return {
    removed,
    probe: {
      create: () => Promise.resolve('"current"'),
      head: (key: string, etag: string) => {
        expect(key).toMatch(/^ops-cleanup-precondition-probes\//);
        return head(etag);
      },
      remove: (key: string) => {
        removed.push(key);
        return Promise.resolve();
      },
    },
  };
}

test("requires the provider to reject a mismatched ETag and accept the current one", async () => {
  for (const message of [
    "An error occurred (412) when calling the HeadObject operation: Precondition Failed",
    "PreconditionFailed",
  ]) {
    const { removed, probe: p } = probe((etag) =>
      etag === '"current"'
        ? Promise.resolve()
        : Promise.reject(new Error(message)),
    );
    await verifyConditionalHead(p);
    expect(removed).toHaveLength(1);
  }
});

test("refuses a provider that ignores the precondition and still removes the probe", async () => {
  const { removed, probe: p } = probe(() => Promise.resolve());
  await expect(verifyConditionalHead(p)).rejects.toThrow(
    "Provider ignored conditional HEAD",
  );
  expect(removed).toHaveLength(1);
});

test("authorization and unsupported-operation errors cannot count as a verified precondition", async () => {
  for (const message of ["AccessDenied", "NotImplemented", "network failure"]) {
    const { probe: p } = probe(() => Promise.reject(new Error(message)));
    await expect(verifyConditionalHead(p)).rejects.toThrow(message);
  }
});

test("a provider that rejects the current ETag fails the probe", async () => {
  const { probe: p } = probe(() =>
    Promise.reject(new Error("PreconditionFailed")),
  );
  await expect(verifyConditionalHead(p)).rejects.toThrow("PreconditionFailed");
});
