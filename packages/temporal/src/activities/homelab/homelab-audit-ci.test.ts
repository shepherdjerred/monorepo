import { beforeEach, describe, expect, test } from "vitest";
import { collectCiMainWith } from "./homelab-audit-ci.ts";

const NOW = new Date("2026-08-10T18:00:00.000Z");
const SINCE_SECONDS = Math.floor((NOW.getTime() - 24 * 60 * 60 * 1000) / 1000);

beforeEach(() => {
  // repoPath() reads this for every request path it builds.
  Bun.env["WOODPECKER_REPO_ID"] = "7";
});

function summary(number: number, status = "success") {
  return {
    number,
    status,
    commit: `commit-${number.toString()}`,
    created: SINCE_SECONDS + number,
  };
}

function detail(
  number: number,
  status = "success",
  failedStep?: { id: number; name: string },
) {
  return {
    ...summary(number, status),
    workflows: [
      {
        name: "verify",
        state: status,
        children:
          failedStep === undefined
            ? []
            : [{ id: failedStep.id, name: failedStep.name, state: "failure" }],
      },
    ],
  };
}

function pipelineUrl(number: number): string {
  return `https://woodpecker.sjer.red/repos/7/pipeline/${number.toString()}`;
}

/** Go []byte values are serialized as standard base64 strings. */
function logBytes(text: string): { data: string }[] {
  return [{ data: Buffer.from(text, "utf8").toString("base64") }];
}

function collectFailedLog(log: unknown) {
  return collectCiMainWith({
    now: NOW,
    pipelineUrl,
    request: (path) =>
      Promise.resolve(
        path.includes("/logs/")
          ? log
          : path.includes("/pipelines?")
            ? [summary(102, "failure")]
            : detail(102, "failure", { id: 777, name: "root verify" }),
      ),
  });
}

describe("Woodpecker log wire format", () => {
  test("joins base64 bytes before decoding UTF-8 split across chunks", async () => {
    const text = "compiler: café 🐑\n";
    const bytes = Buffer.from(text, "utf8");
    const offset = bytes.indexOf(0xc3) + 1;
    const result = await collectFailedLog([
      { data: bytes.subarray(0, offset).toString("base64") },
      { data: bytes.subarray(offset).toString("base64") },
    ]);
    expect(result.check.status).toBe("passed");
    expect(result.findings[0]?.detail).toContain(text.trim());
  });

  test("accepts nil Go byte slices between valid log chunks", async () => {
    const result = await collectFailedLog([
      ...logBytes("first line\n"),
      { data: null, type: 0 },
      ...logBytes("failure cause\n"),
    ]);
    expect(result.check.status).toBe("passed");
    expect(result.findings[0]?.detail).toContain("first line\nfailure cause");
  });

  test.each(["not base64!", "Zg=", "Zh==", "raw café", [65, 66], 4])(
    "fails collection on corrupt or unknown wire data %j",
    async (data) => {
      const result = await collectFailedLog([{ data }]);
      expect(result.check.status).toBe("failed");
      expect(result.evidence.status).toBe("failure");
      expect(result.findings).toEqual([]);
    },
  );

  test("reports arbitrary log bytes and continues collecting subsequent failures", async () => {
    const logRequests: string[] = [];
    const bytes = Buffer.concat([
      Buffer.from("compiler: "),
      Buffer.from([0xff]),
      Buffer.from(" invalid source\n"),
    ]);
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: (path) => {
        if (path.includes("/logs/")) {
          logRequests.push(path);
          return Promise.resolve(
            path.endsWith("/777")
              ? [{ data: bytes.toString("base64") }]
              : logBytes("second failure cause\n"),
          );
        }
        if (path.includes("/pipelines?")) {
          return Promise.resolve([
            summary(102, "failure"),
            summary(103, "failure"),
          ]);
        }
        const number = Number(path.split("/").at(-1));
        return Promise.resolve(
          detail(number, "failure", {
            id: number === 102 ? 777 : 778,
            name: "root verify",
          }),
        );
      },
    });

    expect(result.check.status).toBe("passed");
    expect(result.evidence.status).toBe("success");
    expect(result.limitation).toBeUndefined();
    expect(result.check.summary).toContain("2 failed step logs inspected");
    expect(logRequests).toHaveLength(2);
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]?.detail).toContain("compiler: � invalid source");
    expect(result.findings[1]?.detail).toContain("second failure cause");
  });
});

describe("CI homelab collector", () => {
  test("excludes pull-request pipelines targeting main from main health", async () => {
    const requests: string[] = [];
    const pipelines = [
      { ...summary(103, "failure"), branch: "main", event: "pull_request" },
      { ...summary(102), branch: "main", event: "push" },
    ];
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: (path) => {
        requests.push(path);
        if (path.includes("/pipelines?")) {
          const parameters = new URL(`https://woodpecker.sjer.red${path}`)
            .searchParams;
          return Promise.resolve(
            pipelines.filter(
              (pipeline) =>
                pipeline.branch === parameters.get("branch") &&
                (parameters.get("event") === null ||
                  pipeline.event === parameters.get("event")),
            ),
          );
        }
        if (path.includes("/logs/")) {
          return Promise.resolve(logBytes("pull-request failure"));
        }
        const number = Number(path.split("/").at(-1));
        return Promise.resolve(
          number === 103
            ? detail(103, "failure", { id: 777, name: "root verify" })
            : detail(102),
        );
      },
    });

    expect(result.check.status).toBe("passed");
    expect(result.check.summary).toContain("0 failed of 1 main pipelines");
    expect(result.check.summary).toContain("latest #102 success");
    expect(result.evidence.url).toBe(pipelineUrl(102));
    expect(result.findings).toEqual([]);
    expect(requests).not.toContain("/api/repos/7/pipelines/103");
    expect(requests.some((path) => path.includes("/logs/"))).toBe(false);
  });

  test("paginates over every main pipeline in the 24-hour window", async () => {
    const paths: string[] = [];
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      summary(index + 1),
    );
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: (path) => {
        paths.push(path);
        if (!path.includes("/pipelines?")) {
          const number = Number(path.split("/").at(-1));
          return Promise.resolve(detail(number));
        }
        const page = new URL(
          `https://woodpecker.sjer.red${path}`,
        ).searchParams.get("page");
        return Promise.resolve(page === "1" ? firstPage : [summary(51)]);
      },
    });

    const listPaths = paths.filter((path) => path.includes("/pipelines?"));
    expect(listPaths).toHaveLength(2);
    expect(listPaths[0]).toContain("branch=main");
    expect(listPaths[0]).toContain("after=2026-08-09T18%3A00%3A00.000Z");
    expect(listPaths[0]).toContain("perPage=50");
    expect(result.check.summary).toContain(
      "0 failed of 51 main pipelines in 24h",
    );
    expect(result.check.summary).toContain("latest #51 success");
    expect(result.evidence.url).toBe(pipelineUrl(51));
    expect(result.findings).toEqual([]);
  });

  // A server that ignored `after` would otherwise let the audit claim a
  // 24-hour window it did not actually query.
  test("drops pipelines outside the requested window", async () => {
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: (path) =>
        Promise.resolve(
          path.includes("/pipelines?")
            ? [summary(102), { ...summary(9), created: 1_000_000 }]
            : detail(102),
        ),
    });

    expect(result.check.summary).toContain("of 1 main pipelines");
  });

  test.each(["failure", "killed", "declined"])(
    "reports the latest %s main pipeline",
    async (status) => {
      const requests: string[] = [];
      const failing = status === "failure";
      const result = await collectCiMainWith({
        now: NOW,
        pipelineUrl,
        request: (path) => {
          requests.push(path);
          if (path.includes("/logs/")) {
            return Promise.resolve(logBytes("deterministic failure cause"));
          }
          if (path.includes("/pipelines?")) {
            return Promise.resolve([summary(102, status), summary(101)]);
          }
          const number = Number(path.split("/").at(-1));
          return Promise.resolve(
            number === 102
              ? detail(
                  102,
                  status,
                  failing ? { id: 777, name: "root verify" } : undefined,
                )
              : detail(101),
          );
        },
      });

      expect(result.check.summary).toContain(`latest #102 ${status}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.summary).toBe(
        `CI main pipeline #102 ${status}`,
      );
      expect(requests.filter((path) => path.includes("/logs/"))).toHaveLength(
        failing ? 1 : 0,
      );
      if (failing) {
        expect(result.findings[0]?.detail).toContain(
          "deterministic failure cause",
        );
      }
    },
  );

  test("ignores an older killed pipeline after main returns green", async () => {
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: (path) => {
        if (path.includes("/pipelines?")) {
          return Promise.resolve([summary(102), summary(101, "killed")]);
        }
        const number = Number(path.split("/").at(-1));
        return Promise.resolve(
          detail(number, number === 101 ? "killed" : "success"),
        );
      },
    });

    expect(result.check.summary).toContain("latest #102 success");
    expect(result.findings).toEqual([]);
  });

  test("reports an attention finding when no main pipeline exists in the window", async () => {
    const result = await collectCiMainWith({
      now: NOW,
      pipelineUrl,
      request: () => Promise.resolve([]),
    });

    expect(result.check.status).toBe("passed");
    expect(result.findings[0]?.summary).toContain("No CI main pipelines");
  });
});
