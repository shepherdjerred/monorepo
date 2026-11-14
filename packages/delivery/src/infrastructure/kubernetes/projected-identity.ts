import { readFile } from "node:fs/promises";
import { request } from "node:https";

/**
 * Bound of one response. A collection is read in pages that each fit it
 * (`listKubernetes`), so it holds however many objects the namespace has.
 */
export const KUBERNETES_RESPONSE_BOUND = 1024 * 1024;

/**
 * Bound of one stored object, which can be neither paged nor narrowed. The
 * API server accepts no object over 3 MiB, so this admits every object it
 * can store while still refusing an unbounded body.
 */
export const KUBERNETES_OBJECT_BOUND = 4 * 1024 * 1024;

/**
 * The Kubernetes API did not answer: it refused or dropped the connection,
 * timed out, or answered 429 or 5xx, as it does while the control plane
 * restarts. Retrying the same read may succeed; a refused identity (401,
 * 403) or a missing projection is not this.
 */
export class KubernetesUnavailableError extends Error {
  override readonly name = "KubernetesUnavailableError";
}

/** The Kubernetes API answered a status that retrying will not change. */
export class KubernetesStatusError extends Error {
  override readonly name = "KubernetesStatusError";
  constructor(readonly status: number) {
    super(`Kubernetes identity read answered HTTP ${String(status)}`);
  }
}

/** The path a read names, without its query: a `continue` token is long and says nothing. */
export function kubernetesReadTarget(path: string): string {
  return path.split("?", 1)[0] ?? path;
}

/**
 * A response larger than its bound. It names the read and the size so the
 * refusal can be diagnosed from the API's log or its 503 body: `received` is
 * how much had arrived when the read stopped, and `declared` the response's
 * Content-Length when the API server sent one.
 */
export class KubernetesReadBoundError extends Error {
  override readonly name = "KubernetesReadBoundError";
  readonly target: string;
  constructor(
    path: string,
    readonly bound: number,
    readonly received: number,
    readonly declared?: number,
  ) {
    const target = kubernetesReadTarget(path);
    super(
      `Kubernetes identity read of ${target} exceeded its ${String(bound)}-byte bound: ${
        declared === undefined
          ? `stopped after ${String(received)} bytes`
          : `the response declares ${String(declared)} bytes`
      }`,
    );
    this.target = target;
  }
}

/**
 * One read through a projected, short-lived Kubernetes identity mounted at
 * `directory` (`token` and `ca.crt`). Credentials load lazily on each read
 * so rotation needs no restart. Resolves the parsed body, or null when the
 * object does not exist; any other answer rejects, as does a body over
 * `bound` bytes.
 */
export async function readProjectedKubernetes(
  directory: string,
  path: string,
  bound: number = KUBERNETES_RESPONSE_BOUND,
): Promise<unknown> {
  const [token, ca] = await Promise.all([
    readFile(`${directory}/token`, "utf8"),
    readFile(`${directory}/ca.crt`, "utf8"),
  ]);
  const bytes = await new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const child = request(
      new URL(path, "https://kubernetes.default.svc"),
      { ca, headers: { Authorization: `Bearer ${token.trim()}` } },
      (response) => {
        if (response.statusCode === 404) {
          response.resume();
          resolve(null);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          const status = response.statusCode ?? 0;
          reject(
            status === 429 || status >= 500
              ? new KubernetesUnavailableError(
                  `Kubernetes identity read answered HTTP ${String(status)}`,
                )
              : new KubernetesStatusError(status),
          );
          return;
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > bound) {
          child.destroy(
            new KubernetesReadBoundError(path, bound, size, declared),
          );
          return;
        }
        response.on("data", (chunk: Uint8Array) => {
          size += chunk.byteLength;
          if (size > bound) {
            child.destroy(new KubernetesReadBoundError(path, bound, size));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      },
    );
    const timer = setTimeout(() => {
      child.destroy(
        new KubernetesUnavailableError("Kubernetes identity read timed out"),
      );
    }, 5000);
    child.on("close", () => {
      clearTimeout(timer);
    });
    child.on("error", reject);
    child.end();
  });
  if (bytes === null) return null;
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  return parsed;
}
