import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Loaded } from "@shepherdjerred/loaded/index.ts";
import {
  LoadingBlock,
  LoadingBlockDefaults,
} from "@shepherdjerred/loaded/react.tsx";

const boom = new Error("boom");

describe("LoadingBlock", () => {
  test("renders the fallback while a dependency is loading", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock
        values={{ user: Loaded.done("ada"), org: Loaded.loading() }}
        fallback={<p>loading</p>}
        delayMs={0}
        minDurationMs={0}
      >
        {(data) => <p>{data.user}</p>}
      </LoadingBlock>,
    );
    expect(markup).toBe("<p>loading</p>");
  });

  test("does not flash a fallback on the first paint of a delayed load", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock
        values={{ user: Loaded.loading() }}
        fallback={<p>loading</p>}
      >
        {(data) => <p>{data.user}</p>}
      </LoadingBlock>,
    );
    expect(markup).toBe("");
  });

  test("renders the error surface when a dependency has no data", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock
        values={{ user: Loaded.failed(boom) }}
        renderError={(errors) => <p>{errors[0].path.join(".")}</p>}
      >
        {(data) => <p>{data.user}</p>}
      </LoadingBlock>,
    );
    expect(markup).toBe("<p>user</p>");
  });

  test("renders children with every dependency joined", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock
        values={{ user: Loaded.done("ada"), org: Loaded.done("acme") }}
      >
        {(data) => (
          <p>
            {data.user}@{data.org}
          </p>
        )}
      </LoadingBlock>,
    );
    expect(markup).toBe("<p>ada@acme</p>");
  });

  test("renders degraded data and hands the errors to the child", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock
        values={{
          user: Loaded.done("ada"),
          org: Loaded.degraded("acme", [{ path: [], error: boom }]),
        }}
      >
        {(data, meta) => (
          <p>
            {data.org}:{meta.errors.length}
          </p>
        )}
      </LoadingBlock>,
    );
    expect(markup).toBe("<p>acme:1</p>");
  });

  test("reports a refresh in flight without withholding the data", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlock values={{ user: Loaded.refreshing("ada") }}>
        {(data, meta) => (
          <p>
            {data.user}:{String(meta.fetching)}
          </p>
        )}
      </LoadingBlock>,
    );
    expect(markup).toBe("<p>ada:true</p>");
  });
});

describe("LoadingBlockDefaults", () => {
  test("supplies the fallback and error surface to nested blocks", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlockDefaults
        fallback={<p>spinner</p>}
        renderError={(errors) => <p>failed:{errors.length}</p>}
      >
        <LoadingBlock values={{ user: Loaded.loading() }} delayMs={0}>
          {(data) => <p>{data.user}</p>}
        </LoadingBlock>
        <LoadingBlock values={{ org: Loaded.failed(boom) }} delayMs={0}>
          {(data) => <p>{data.org}</p>}
        </LoadingBlock>
      </LoadingBlockDefaults>,
    );
    expect(markup).toBe("<p>spinner</p><p>failed:1</p>");
  });

  test("an explicit prop overrides the provided default", () => {
    const markup = renderToStaticMarkup(
      <LoadingBlockDefaults
        fallback={<p>spinner</p>}
        renderError={() => <p>failed</p>}
      >
        <LoadingBlock
          values={{ user: Loaded.loading() }}
          fallback={<p>local</p>}
          delayMs={0}
        >
          {(data) => <p>{data.user}</p>}
        </LoadingBlock>
      </LoadingBlockDefaults>,
    );
    expect(markup).toBe("<p>local</p>");
  });
});
