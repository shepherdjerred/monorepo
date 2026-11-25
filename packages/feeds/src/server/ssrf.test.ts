import { describe, expect, test } from "vitest";
import {
  isPrivateOrReservedIp,
  redactUrlForDisplay,
  safeFetch,
  sanitizeErrorMessage,
  SsrfBlockedError,
} from "./ssrf.ts";

async function publicLookup(hostname: string): Promise<readonly string[]> {
  return hostname === "example.com" || hostname === "cdn.example.com"
    ? ["93.184.216.34"]
    : [];
}

describe("isPrivateOrReservedIp", () => {
  test("blocks private, loopback, link-local, CGNAT/Tailscale, multicast, and reserved IPv4 ranges", () => {
    const blockedIpv4 = [
      "0.0.0.0",
      "0.12.34.56",
      "10.0.0.1",
      "10.255.255.254",
      "100.64.0.1",
      "100.100.100.100",
      "100.127.255.254",
      "127.0.0.1",
      "127.255.255.255",
      "169.254.169.254",
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.254",
      "192.0.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.19.255.254",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
    ];
    for (const ip of blockedIpv4) {
      expect(isPrivateOrReservedIp(ip), `expected ${ip} to be blocked`).toBe(
        true,
      );
    }
  });

  test("allows public IPv4 addresses including boundaries adjacent to CGNAT and RFC1918", () => {
    const publicIpv4 = [
      "1.1.1.1",
      "8.8.8.8",
      "93.184.216.34",
      "100.63.255.255",
      "100.128.0.1",
      "172.15.255.254",
      "172.32.0.1",
      "192.0.1.1",
      "198.17.255.255",
      "198.20.0.1",
    ];
    for (const ip of publicIpv4) {
      expect(isPrivateOrReservedIp(ip), `expected ${ip} to be allowed`).toBe(
        false,
      );
    }
  });

  test("blocks private/reserved IPv6 and IPv4-mapped IPv6 addresses while allowing public IPv6", () => {
    const blockedIpv6 = [
      "::",
      "::1",
      "[::1]",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%lo0",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::FFFF:100.64.0.42",
      "::ffff:169.254.169.254",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:10.0.0.5",
      "not-an-ip",
    ];
    for (const ip of blockedIpv6) {
      expect(isPrivateOrReservedIp(ip), `expected ${ip} to be blocked`).toBe(
        true,
      );
    }

    expect(isPrivateOrReservedIp("2606:2800:220:1:248:1893:25c8:1946")).toBe(
      false,
    );
    expect(isPrivateOrReservedIp("::ffff:93.184.216.34")).toBe(false);
  });
});

describe("safeFetch", () => {
  test("rejects disallowed protocols, embedded credentials, non-default ports, and local hostnames", async () => {
    const rejectedUrls = [
      "ftp://example.com/feed.xml",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com/feed.xml",
      "https://user@example.com/feed.xml",
      "http://example.com:8080/feed.xml",
      "https://example.com:8443/feed.xml",
      "http://example.com:443/feed.xml",
      "https://example.com:80/feed.xml",
      "http://localhost/feed.xml",
      "http://sub.localhost/feed.xml",
      "http://printer.local/feed.xml",
      "http://metadata.internal/feed.xml",
      "http://flags.default.svc.cluster.local/v1/evaluate",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.100.100/feed.xml",
      "http://[::ffff:127.0.0.1]/feed.xml",
    ];

    for (const badUrl of rejectedUrls) {
      await expect(
        safeFetch(badUrl, { lookupHost: publicLookup }),
        `expected ${badUrl} to throw SsrfBlockedError`,
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  test("blocks empty DNS responses and DNS responses containing any private IP", async () => {
    await expect(
      safeFetch("https://unresolvable.example.org/rss", {
        lookupHost: async () => [],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    await expect(
      safeFetch("https://rebind.example.org/rss", {
        lookupHost: async () => ["93.184.216.34", "10.0.0.8"],
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test("follows public redirects manually and blocks redirect hops targeting loopback or metadata IPs", async () => {
    const visited: string[] = [];
    const okResult = await safeFetch("http://example.com:80/rss", {
      lookupHost: publicLookup,
      fetchImpl: async (url) => {
        visited.push(url);
        if (url === "http://example.com/rss") {
          return new Response(null, {
            status: 301,
            headers: { Location: "https://cdn.example.com:443/atom.xml" },
          });
        }
        return new Response("<feed/>", { status: 200 });
      },
    });

    expect(okResult.status).toBe(200);
    expect(okResult.finalUrl).toBe("https://cdn.example.com/atom.xml");
    expect(okResult.body).toBe("<feed/>");
    expect(visited).toEqual([
      "http://example.com/rss",
      "https://cdn.example.com/atom.xml",
    ]);

    await expect(
      safeFetch("https://example.com/evil-redirect", {
        lookupHost: publicLookup,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "http://127.0.0.1/internal" },
          }),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);

    await expect(
      safeFetch("https://example.com/loop", {
        maxRedirects: 2,
        lookupHost: publicLookup,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "/loop" },
          }),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  test("aborts and throws when streamed body exceeds maxBytes", async () => {
    let streamCancelled = false;
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(600));
      },
      cancel() {
        streamCancelled = true;
      },
    });

    await expect(
      safeFetch("https://example.com/huge.xml", {
        maxBytes: 1024,
        lookupHost: publicLookup,
        fetchImpl: async () => new Response(oversizedStream, { status: 200 }),
      }),
    ).rejects.toThrow(/exceeded maximum size/iu);

    expect(streamCancelled).toBe(true);
  });
});

describe("redactUrlForDisplay and sanitizeErrorMessage", () => {
  test("redacts query params and credentials for user feeds while keeping code feeds intact", () => {
    const lwnUrl = "https://lwn.net/headlines/newrss?token=my_private_lwn_key";
    expect(redactUrlForDisplay(lwnUrl, "user")).toBe(
      "https://lwn.net/headlines/newrss?[REDACTED]",
    );
    expect(redactUrlForDisplay(lwnUrl, "code")).toBe(lwnUrl);

    const credUrl = "https://subscriber:pw123@example.com/private.xml?k=xyz";
    expect(redactUrlForDisplay(credUrl, "user")).toBe(
      "https://example.com/private.xml?[REDACTED]",
    );
    expect(
      redactUrlForDisplay("https://blog.example.com/rss.xml", "user"),
    ).toBe("https://blog.example.com/rss.xml");
  });

  test("strips raw query strings and full secret URLs from error messages", () => {
    const secretUrl =
      "https://lwn.net/headlines/newrss?key=super_secret_token_99";
    const leakedError = `Fetch failed for ${secretUrl} (query key=super_secret_token_99 rejected)`;
    const sanitized = sanitizeErrorMessage(leakedError, secretUrl);

    expect(sanitized).not.toContain("super_secret_token_99");
    expect(sanitized).toContain("https://lwn.net/headlines/newrss?[REDACTED]");
  });
});
