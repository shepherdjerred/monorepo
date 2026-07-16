import { describe, expect, test } from "bun:test";
import {
  BLACKBOX_MODULES,
  HTTP_2XX_MODULE,
  HTTPS_2XX_INSECURE_MODULE,
  RSS_2XX_MODULE,
  TCP_CONNECT_MODULE,
} from "./blackbox-modules.ts";

describe("BLACKBOX_MODULES", () => {
  test("exposes exactly the four modules service files reference by name", () => {
    expect(Object.keys(BLACKBOX_MODULES).toSorted()).toEqual([
      "http_2xx",
      "https_2xx_insecure",
      "rss_2xx",
      "tcp_connect",
    ]);
  });
});

describe("HTTPS_2XX_INSECURE_MODULE", () => {
  test("is an http prober with insecure_skip_verify set", () => {
    expect(HTTPS_2XX_INSECURE_MODULE.prober).toBe("http");
    expect(HTTPS_2XX_INSECURE_MODULE.http.tls_config).toEqual({
      insecure_skip_verify: true,
    });
  });

  test("accepts the same status codes as the plain HTTP module", () => {
    expect(HTTPS_2XX_INSECURE_MODULE.http.valid_status_codes).toEqual(
      HTTP_2XX_MODULE.http.valid_status_codes,
    );
  });

  test("does not set tls_config on the plain HTTP/RSS modules (no accidental TLS skip)", () => {
    expect(HTTP_2XX_MODULE.http.tls_config).toBeUndefined();
    expect(RSS_2XX_MODULE.http.tls_config).toBeUndefined();
  });
});

describe("TCP_CONNECT_MODULE", () => {
  test("is a bare tcp prober with no HTTP semantics", () => {
    expect(TCP_CONNECT_MODULE).toEqual({ prober: "tcp", timeout: "10s" });
  });
});
