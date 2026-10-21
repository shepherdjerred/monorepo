import { readFile } from "node:fs/promises";
import { request } from "node:https";

const LIMIT = 1024 * 1024;

/**
 * One read through a projected, short-lived Kubernetes identity mounted at
 * `directory` (`token` and `ca.crt`). Credentials load lazily on each read
 * so rotation needs no restart. Resolves the parsed body, or null when the
 * object does not exist; any other answer rejects.
 */
export async function readProjectedKubernetes(
  directory: string,
  path: string,
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
          reject(new Error("Kubernetes identity read did not succeed"));
          return;
        }
        response.on("data", (chunk: Uint8Array) => {
          size += chunk.byteLength;
          if (size > LIMIT) {
            child.destroy(
              new Error("Kubernetes identity read exceeded its bound"),
            );
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
      child.destroy(new Error("Kubernetes identity read timed out"));
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
