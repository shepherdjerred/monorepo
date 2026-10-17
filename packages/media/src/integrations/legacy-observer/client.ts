import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { LegacyObservationError, type ObserverRequest } from "./wire.ts";

export function kubernetesObserverRequest(
  environment: Record<string, string | undefined>,
): ObserverRequest {
  const host = environment["KUBERNETES_SERVICE_HOST"];
  const port =
    environment["KUBERNETES_SERVICE_PORT_HTTPS"] ??
    environment["KUBERNETES_SERVICE_PORT"];
  if (
    host === undefined ||
    port === undefined ||
    !/^[a-zA-Z0-9.:-]+$/u.test(host) ||
    !/^\d{1,5}$/u.test(port)
  )
    throw new LegacyObservationError("bootstrap_missing");
  const origin = new URL(
    `https://${host.includes(":") ? `[${host}]` : host}:${port}`,
  );
  const root = "/var/run/secrets/kubernetes.io/serviceaccount";
  return async (path, signal) => {
    if (
      !/^\/(?:api\/v1|apis\/(?:apps\/v1|batch\/v1|autoscaling\/v2))\/namespaces\/media\/[a-z]+(?:\/[a-z0-9.-]+)?(?:\?[^#]*)?$/u.test(
        path,
      )
    )
      throw new LegacyObservationError("request_outside_scope");
    const [token, ca] = await Promise.all([
      readFile(`${root}/token`, "utf8"),
      readFile(`${root}/ca.crt`, "utf8"),
    ]);
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        new URL(path, origin),
        {
          method: "GET",
          ca,
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            Accept: "application/json",
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(
              new LegacyObservationError(
                response.statusCode === 403
                  ? "api_forbidden"
                  : "api_unavailable",
              ),
            );
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 4 * 1024 * 1024) {
              request.destroy();
              reject(new LegacyObservationError("response_byte_limit"));
            } else chunks.push(chunk);
          });
          response.on("error", () => {
            reject(new LegacyObservationError("response_interrupted"));
          });
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new LegacyObservationError("response_invalid_json"));
            }
          });
        },
      );
      request.on("error", () => {
        reject(new LegacyObservationError("request_failed"));
      });
      request.end();
    });
  };
}
