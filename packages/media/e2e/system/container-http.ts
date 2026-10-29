import type { FetchTransport } from "#integrations/http.ts";

/** Docker internal networks deliberately have no host-published ports. Send
 * actual HTTP to container loopback through stdin, without granting peer egress.
 */
export function containerHttp(name: string): FetchTransport {
  return async (url, init) => {
    if (url.origin !== "http://127.0.0.1:8080")
      throw new Error(
        "Acceptance transport only reaches its own peer loopback",
      );
    const request = new Request(url.toString(), init);
    const args = [
      "docker",
      "exec",
      "--interactive",
      name,
      "curl",
      "--silent",
      "--show-error",
      "--include",
      "--max-time",
      "15",
      "--request",
      request.method,
    ];
    for (const [key, value] of request.headers)
      args.push("--header", `${key}: ${value}`);
    const body = new Uint8Array(await request.arrayBuffer());
    if (request.body !== null) args.push("--data-binary", "@-");
    args.push(url.toString());
    const { OP_SERVICE_ACCOUNT_TOKEN: _vault, ...environment } = Bun.env;
    const child = Bun.spawn(args, {
      env: environment,
      stdin: body,
      stdout: "pipe",
      stderr: "pipe",
    });
    const abort = () => {
      child.kill("SIGTERM");
    };
    init.signal?.addEventListener("abort", abort, { once: true });
    try {
      const [bytes, code] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        child.exited,
        new Response(child.stderr).text(),
      ]);
      init.signal?.throwIfAborted();
      if (code !== 0)
        throw new Error(`Acceptance HTTP transport failed (${String(code)})`);
      const wire = Buffer.from(bytes);
      const boundary = wire.indexOf("\r\n\r\n");
      if (boundary === -1)
        throw new Error("Container HTTP response headers missing");
      const [line = "", ...fields] = wire
        .subarray(0, boundary)
        .toString()
        .split("\r\n");
      const match = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(line);
      if (match?.[1] === undefined)
        throw new Error("Container HTTP status invalid");
      const headers = new Headers();
      for (const field of fields) {
        const colon = field.indexOf(":");
        if (colon < 1) throw new Error("Container HTTP header invalid");
        headers.append(field.slice(0, colon), field.slice(colon + 1).trim());
      }
      const status = Number(match[1]);
      return new Response(status === 204 ? null : wire.subarray(boundary + 4), {
        status,
        headers,
      });
    } finally {
      init.signal?.removeEventListener("abort", abort);
    }
  };
}
