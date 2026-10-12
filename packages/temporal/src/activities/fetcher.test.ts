import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod/v4";
import { fetcherActivities } from "./fetcher.ts";

const documentName =
  "projects/sc-site-a8f24/databases/(default)/documents/content-location/lol-content-location";
const readTime = "2026-10-08T00:00:00Z";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manifest lookup through the Firebase Firestore Lite SDK", () => {
  test("decodes a Firestore document and requests the existing manifest path", async () => {
    fetchMock.mockResolvedValue(
      Response.json([
        {
          found: {
            name: documentName,
            fields: { dumpUrl: { stringValue: "manifest-fixture.json" } },
            createTime: readTime,
            updateTime: readTime,
          },
          readTime,
        },
      ]),
    );

    await expect(fetcherActivities.getFirestoreManifestUrl()).resolves.toBe(
      "manifest-fixture.json",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0];
    expect(request?.[1]?.method).toBe("POST");
    const requestBody = z.string().parse(request?.[1]?.body);
    expect(JSON.parse(requestBody)).toEqual({
      documents: [documentName],
    });
  });

  test("rejects a missing manifest document", async () => {
    fetchMock.mockResolvedValue(
      Response.json([{ missing: documentName, readTime }]),
    );

    await expect(
      fetcherActivities.getFirestoreManifestUrl(),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  test("rejects a manifest field with the wrong Firestore type", async () => {
    fetchMock.mockResolvedValue(
      Response.json([
        {
          found: {
            name: documentName,
            fields: { dumpUrl: { integerValue: "42" } },
            createTime: readTime,
            updateTime: readTime,
          },
          readTime,
        },
      ]),
    );

    await expect(
      fetcherActivities.getFirestoreManifestUrl(),
    ).rejects.toMatchObject({ name: "ZodError" });
  });

  test("preserves an upstream permission failure", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: { code: 403, status: "PERMISSION_DENIED", message: "Denied" },
        },
        { status: 403 },
      ),
    );

    await expect(
      fetcherActivities.getFirestoreManifestUrl(),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
