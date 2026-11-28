import { describe, expect, test } from "vitest";
import { workerApplicationResources } from "./worker-hosts.ts";

function readInvalidSpecTempo(path: string): Promise<unknown> {
  if (path === "tempo/resource-tree") {
    return Promise.reject(new Error("Argo API returned HTTP 500"));
  }
  return Promise.resolve({
    status: {
      conditions: [
        {
          type: "InvalidSpecError",
          message: "chart version 9.9.9 not found",
        },
      ],
    },
  });
}

describe("workerApplicationResources ComparisonError diagnostics", () => {
  test("surfaces ComparisonError condition details when resource-tree returns HTTP 500", async () => {
    const reads: string[] = [];
    const read = async (path: string): Promise<unknown> => {
      reads.push(path);
      if (path === "minecraft-tsmc/resource-tree") {
        throw new Error("Argo API returned HTTP 500");
      }
      if (path === "minecraft-tsmc") {
        return {
          status: {
            sync: { status: "Unknown" },
            conditions: [
              {
                type: "ComparisonError",
                message:
                  'Failed to compare desired state to live state: StatefulSet.apps "minecraft-tsmc" is invalid: spec.volumeClaimTemplates: Invalid value: immutable',
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    };

    await expect(
      workerApplicationResources("minecraft-tsmc", "Pod", read),
    ).rejects.toThrow(
      /minecraft-tsmc \(Argo API returned HTTP 500\): ComparisonError: .*spec\.volumeClaimTemplates: Invalid value: immutable/u,
    );
    expect(reads).toEqual(["minecraft-tsmc/resource-tree", "minecraft-tsmc"]);
  });

  test("surfaces InvalidSpecError condition details when resource-tree fails", async () => {
    await expect(
      workerApplicationResources("tempo", "StatefulSet", readInvalidSpecTempo),
    ).rejects.toThrow(
      "Argo resource-tree read failed for tempo (Argo API returned HTTP 500): InvalidSpecError: chart version 9.9.9 not found",
    );
  });

  test("rethrows original resource-tree error when no comparison or spec condition is present", async () => {
    const original = new Error("Argo API returned HTTP 502");
    const read = async (path: string): Promise<unknown> => {
      if (path.endsWith("/resource-tree")) {
        throw original;
      }
      return { status: { conditions: [] } };
    };

    await expect(
      workerApplicationResources("temporal", "Deployment", read),
    ).rejects.toBe(original);
  });

  test("rethrows original resource-tree error when fallback Application read also fails", async () => {
    const original = new Error("Argo API returned HTTP 503");
    const read = async (path: string): Promise<unknown> => {
      if (path.endsWith("/resource-tree")) {
        throw original;
      }
      throw new Error("Argo API unreachable");
    };

    await expect(
      workerApplicationResources("temporal", "Deployment", read),
    ).rejects.toBe(original);
  });
});
