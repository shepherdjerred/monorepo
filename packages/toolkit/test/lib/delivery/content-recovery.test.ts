import { expect, test } from "vitest";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  runDeployCommand,
  validateDeployCommand,
} from "#commands/deploy/deploy.ts";
import { deployMachineCredential } from "#commands/deploy/forum.ts";
import { parseDeployArgs } from "#commands/deploy/common.ts";

const reason =
  "Independently inspect the exact retained release before native repair";

test.each(["sites", "forum"])(
  "%s recovery inspection is a read and keeps missing-identity errors",
  async (domain) => {
    const client = createDeliveryClient({
      baseUrl: "http://delivery.test",
      fetch: (url, init) => {
        expect(url instanceof Request ? url.url : url.toString()).toBe(
          "http://delivery.test/api/v1/content-recovery/exact%2Fintent",
        );
        expect(init?.method ?? "GET").toBe("GET");
        expect(init?.body).toBeUndefined();
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: "NOT_FOUND",
                message: "No recovery intent matches this exact identity",
                requestId: "read/intent",
              },
            },
            { status: 404 },
          ),
        );
      },
    });
    await expect(
      runDeployCommand(
        client,
        domain,
        ["recovery", "exact/intent"],
        parseDeployArgs([]).values,
      ),
    ).rejects.toThrow("No recovery intent matches this exact identity");
  },
);

test.each(["sites", "forum"])(
  "%s recovery validates admin authority and generation before credential resolution",
  (domain) => {
    expect(deployMachineCredential(domain, ["recover", "failed/id"])).toBe(
      "DELIVERY_API_TOKEN",
    );
    for (const [args, error] of [
      [[], "admin --machine"],
      [["--machine"], "--expected-generation"],
    ] as const)
      expect(() =>
        validateDeployCommand(
          domain,
          ["recover", "failed/id"],
          parseDeployArgs([...args]).values,
        ),
      ).toThrow(error);
    for (const args of [
      ["--machine", "--expected-generation", "3", "--reason", "short"],
      ["--machine", "--expected-generation", "-1", "--reason", reason],
    ])
      expect(() =>
        validateDeployCommand(
          domain,
          ["recover", "failed/id"],
          parseDeployArgs(args).values,
        ),
      ).toThrow();
    expect(() =>
      validateDeployCommand(
        domain,
        ["recovery", "intent/id"],
        parseDeployArgs([]).values,
      ),
    ).not.toThrow();
  },
);

test.each(["sites", "forum"])(
  "%s sends only frozen admin intent and preserves a native refusal",
  async (domain) => {
    let received: unknown;
    const client = createDeliveryClient({
      baseUrl: "http://delivery.test",
      fetch: (url, init) => {
        if (typeof init?.body !== "string")
          throw new TypeError("Expected JSON intent");
        received = {
          url: url instanceof Request ? url.url : url.toString(),
          body: JSON.parse(init.body) as unknown,
        };
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: "CONFLICT",
                message: "Original executor remains active; ownership retained",
                requestId: "native/refused",
              },
            },
            { status: 409 },
          ),
        );
      },
    });
    const notices: string[] = [];
    await expect(
      runDeployCommand(client, domain, ["recover", "failed/id"], {
        ...parseDeployArgs([
          "--machine",
          "--request-id",
          "recovery/reviewed",
          "--expected-generation",
          "3",
          "--reason",
          reason,
        ]).values,
        requestNotice: (id) => {
          notices.push(id);
        },
      }),
    ).rejects.toThrow("Original executor remains active; ownership retained");
    expect(received).toEqual({
      url: "http://delivery.test/api/v1/deployments/failed%2Fid/content-recovery",
      body: {
        requestId: "recovery/reviewed",
        expectedEnvironmentGeneration: 3,
        reason,
      },
    });
    expect(notices).toEqual(["recovery/reviewed"]);
  },
);
