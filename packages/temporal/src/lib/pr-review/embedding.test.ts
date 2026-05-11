import { describe, expect, test } from "bun:test";
import {
  cosineSimilarity,
  embedClaim,
  EMBEDDING_DIM,
  type VoyageFetch,
} from "./embedding.ts";

const fetchHttp503: VoyageFetch = async () =>
  new Response("oops", { status: 503 });
const fetchHttp500: VoyageFetch = async () =>
  new Response("nope", { status: 500 });
const fetchNetworkError: VoyageFetch = async () => {
  throw new TypeError("connect ECONNREFUSED");
};
const fetchSchemaMismatch: VoyageFetch = async () =>
  Response.json({ bogus: true }, { status: 200 });

function unitVector(dim: number, seed: number): number[] {
  const v = Array.from({ length: dim }, () => 0);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.sin(seed + i);
    norm += (v[i] ?? 0) * (v[i] ?? 0);
  }
  const s = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / s;
  return v;
}

describe("cosineSimilarity", () => {
  test("identical unit vectors → 1.0", () => {
    const v = unitVector(EMBEDDING_DIM, 1);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
  });

  test("orthogonal vectors → 0", () => {
    const a = Array.from({ length: EMBEDDING_DIM }, () => 0);
    a[0] = 1;
    const b = Array.from({ length: EMBEDDING_DIM }, () => 0);
    b[1] = 1;
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("anti-parallel vectors → -1", () => {
    const a = Array.from({ length: EMBEDDING_DIM }, () => 0);
    a[0] = 1;
    const b = Array.from({ length: EMBEDDING_DIM }, () => 0);
    b[0] = -1;
    expect(cosineSimilarity(a, b)).toBe(-1);
  });

  test("zero vector → 0 (defensive)", () => {
    const zero = Array.from({ length: EMBEDDING_DIM }, () => 0);
    const v = unitVector(EMBEDDING_DIM, 1);
    expect(cosineSimilarity(zero, v)).toBe(0);
  });

  test("length mismatch → 0", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe("embedClaim — provider fallback path", () => {
  test("voyage primary success returns provider=voyage", async () => {
    const fakeVec = unitVector(EMBEDDING_DIM, 7);
    const fakeFetch: VoyageFetch = async () =>
      Response.json(
        { data: [{ embedding: fakeVec }] },
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await embedClaim("hello world", {
      voyageApiKey: "test",
      voyageFetch: fakeFetch,
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.provider).toBe("voyage");
    expect(result.vector.length).toBe(EMBEDDING_DIM);
  });

  test("missing api key triggers local fallback", async () => {
    const localVec = unitVector(EMBEDDING_DIM, 13);
    const result = await embedClaim("hello world", {
      voyageApiKey: "",
      localEmbedder: async () => localVec,
    });
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.provider).toBe("local");
  });

  test("voyage rate-limit (429) triggers local fallback", async () => {
    const localVec = unitVector(EMBEDDING_DIM, 22);
    let voyageCallCount = 0;
    const fakeFetch: VoyageFetch = async () => {
      voyageCallCount += 1;
      return new Response("rate limited", { status: 429 });
    };
    const result = await embedClaim("foo bar", {
      voyageApiKey: "test",
      voyageFetch: fakeFetch,
      localEmbedder: async () => localVec,
    });
    expect(voyageCallCount).toBe(1);
    expect(result?.provider).toBe("local");
  });

  test("voyage 5xx triggers local fallback", async () => {
    const localVec = unitVector(EMBEDDING_DIM, 33);
    const result = await embedClaim("xyz", {
      voyageApiKey: "test",
      voyageFetch: fetchHttp503,
      localEmbedder: async () => localVec,
    });
    expect(result?.provider).toBe("local");
  });

  test("voyage network error triggers local fallback", async () => {
    const localVec = unitVector(EMBEDDING_DIM, 44);
    const result = await embedClaim("err case", {
      voyageApiKey: "test",
      voyageFetch: fetchNetworkError,
      localEmbedder: async () => localVec,
    });
    expect(result?.provider).toBe("local");
  });

  test("schema-mismatched voyage response triggers local fallback", async () => {
    const localVec = unitVector(EMBEDDING_DIM, 55);
    const result = await embedClaim("x", {
      voyageApiKey: "test",
      voyageFetch: fetchSchemaMismatch,
      localEmbedder: async () => localVec,
    });
    expect(result?.provider).toBe("local");
  });

  test("both providers failing returns null (caller fails closed)", async () => {
    const result = await embedClaim("x", {
      voyageApiKey: "test",
      voyageFetch: fetchHttp500,
      localEmbedder: async () => {
        throw new Error("local also dead");
      },
    });
    expect(result).toBeNull();
  });

  test("local returning wrong-dim vector → null", async () => {
    const result = await embedClaim("x", {
      voyageApiKey: "test",
      voyageFetch: fetchHttp500,
      localEmbedder: async () => [1, 2, 3], // wrong dim
    });
    expect(result).toBeNull();
  });
});
