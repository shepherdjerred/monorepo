import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { DeliveryError } from "#domain/error.ts";

export type IngressKubernetesReader = (path: string) => Promise<unknown>;
const directory = "/var/run/delivery-ingress";

/** Lazy projected, read-only identity. Health and bearer requests never load Kubernetes credentials. */
export const readIngressKubernetes: IngressKubernetesReader = async (path) => {
  try {
    const [token, ca] = await Promise.all([
      readFile(`${directory}/token`, "utf8"),
      readFile(`${directory}/ca.crt`, "utf8"),
    ]);
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const child = request(
        new URL(path, "https://kubernetes.default.svc"),
        { ca, headers: { Authorization: `Bearer ${token.trim()}` } },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("Kubernetes identity read did not succeed"));
            return;
          }
          response.on("data", (chunk: Uint8Array) => {
            size += chunk.byteLength;
            if (size > 1024 * 1024) {
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
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    return parsed;
  } catch {
    throw new DeliveryError(
      "PAUSED",
      "Private ingress identity verification is unavailable; Kubernetes read access is required for human authentication",
    );
  }
};
