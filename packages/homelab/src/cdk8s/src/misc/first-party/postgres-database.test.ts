import { App, Chart, Testing } from "cdk8s";
import { Deployment } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { z } from "zod";
import {
  buildPostgresUrlExpr,
  singleAppDatabase,
} from "./postgres-database.ts";

function chart() {
  return new Chart(new App(), "example", {
    namespace: "example",
    disableResourceNameHashes: true,
  });
}

describe("singleAppDatabase", () => {
  test("provisions the app's cluster in the chart", () => {
    const scope = chart();
    singleAppDatabase(scope, {
      app: "example",
      provision: true,
      userFlags: [],
    });
    const [cluster] = Testing.synth(scope);
    expect(cluster).toMatchObject({
      kind: "postgresql",
      metadata: { name: "example-postgresql" },
      spec: { databases: { example_db: "example" } },
    });
  });

  test("connecting to a cluster another chart owns renders nothing", () => {
    const scope = chart();
    const database = singleAppDatabase(scope, {
      app: "example",
      provision: false,
    });
    expect(Testing.synth(scope)).toEqual([]);
    expect(database.credentials.name).toBe(
      "example.example-postgresql.credentials.postgresql.acid.zalan.do",
    );
  });

  test("declares the credentials before the URL that expands them", () => {
    const scope = chart();
    const database = singleAppDatabase(scope, {
      app: "example",
      provision: false,
    });
    new Deployment(scope, "app", {
      containers: [{ image: "example", envVariables: database.env }],
    });
    const env = ContainerEnvSchema.parse(
      z
        .object({
          spec: z.object({
            template: z.object({
              spec: z.object({
                containers: z.array(z.object({ env: z.unknown() })),
              }),
            }),
          }),
        })
        .parse(Testing.synth(scope)[0]).spec.template.spec.containers[0]?.env,
    );
    expect(env.map((variable) => variable.name)).toEqual([
      "DB_USER",
      "DB_PASSWORD",
      "DATABASE_URL",
    ]);
    expect(env[2]).toEqual({
      name: "DATABASE_URL",
      value: buildPostgresUrlExpr("example-postgresql:5432", "example_db"),
    });
  });

  test("the cluster policy admits the clients, the operator and its peers", () => {
    const scope = chart();
    const database = singleAppDatabase(scope, {
      app: "example",
      provision: false,
    });
    database.createClusterIngressPolicy("db-netpol", { app: "example" });
    const [policy] = Testing.synth(scope);
    expect(policy).toMatchObject({
      kind: "NetworkPolicy",
      spec: {
        podSelector: { matchLabels: { "cluster-name": "example-postgresql" } },
        policyTypes: ["Ingress"],
        ingress: [
          { from: [{ podSelector: { matchLabels: { app: "example" } } }] },
          {},
          {},
        ],
      },
    });
    expect(database.egress.to).toEqual([
      {
        podSelector: { matchLabels: { "cluster-name": "example-postgresql" } },
      },
    ]);
  });
});

test("the connection URL references the kubelet-expanded credentials", () => {
  expect(buildPostgresUrlExpr("db:5432", "app_db")).toBe(
    "postgresql://$(DB_USER):$(DB_" + "PASSWORD)@db:5432/app_db",
  );
});
