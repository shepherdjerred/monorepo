import { describe, expect, test } from "vitest";
import { z } from "zod";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const request = {
  upstream: "gql",
  url: "https://api.example/graphql",
  headers: { authorization: "k" },
  query: "query { viewer { id } }",
};
const Schema = z.object({ viewer: z.object({ id: z.string() }) });

describe("postGraphql", () => {
  test("posts the operation and returns validated data", async () => {
    const { fetch, requests } = sequence({ data: { viewer: { id: "1" } } });
    await expect(postGraphql(fetch, request, Schema)).resolves.toEqual({
      viewer: { id: "1" },
    });
    expect(requests[0]?.body).toEqual({ query: request.query, variables: {} });
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
  });

  test("missing data is an upstream failure", async () => {
    const { fetch } = sequence({});
    await expect(postGraphql(fetch, request, Schema)).rejects.toThrow(
      "gql: GraphQL response had no data",
    );
  });
});
