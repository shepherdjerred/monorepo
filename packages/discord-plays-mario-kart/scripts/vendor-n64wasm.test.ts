import { expect, test } from "bun:test";
import { parseN64Upstream, parseVendorExcludes } from "./upstream.ts";

test("parses comments and blank lines from vendor excludes", () => {
  expect(parseVendorExcludes("# comment\ncode/a # reason\n\ncode/b\n")).toEqual(
    ["code/a", "code/b"],
  );
});

test("validates a complete immutable upstream pin", () => {
  const upstream = {
    repository: "https://example.com/n64wasm.git",
    branch: "main",
    commit: "0123456789abcdef0123456789abcdef01234567",
    emsdkImage: "emscripten/emsdk:4.0.10",
  };
  expect(parseN64Upstream(upstream)).toEqual(upstream);
});
