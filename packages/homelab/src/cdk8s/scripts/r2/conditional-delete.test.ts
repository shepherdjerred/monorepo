import { expect, test } from "vitest";
import { verifyConditionalDelete } from "./conditional-delete.ts";

test("requires the provider to reject a mismatched ETag before cleanup", async () => {
  const removed: string[] = [];
  await verifyConditionalDelete({
    create: () => Promise.resolve('"current"'),
    remove: (key, etag) => {
      expect(key).toMatch(/^ops-cleanup-precondition-probes\//);
      if (etag !== '"current"')
        return Promise.reject(new Error("PreconditionFailed"));
      removed.push(key);
      return Promise.resolve();
    },
  });
  expect(removed).toHaveLength(1);
});

test("refuses a provider that ignores the precondition", async () => {
  await expect(
    verifyConditionalDelete({
      create: () => Promise.resolve('"current"'),
      remove: () => Promise.resolve(),
    }),
  ).rejects.toThrow("Provider ignored conditional DELETE");
});

test("authorization and unsupported-operation errors cannot count as a verified precondition", async () => {
  for (const message of ["AccessDenied", "NotImplemented", "network failure"]) {
    await expect(
      verifyConditionalDelete({
        create: () => Promise.resolve('"current"'),
        remove: () => Promise.reject(new Error(message)),
      }),
    ).rejects.toThrow(message);
  }
});
