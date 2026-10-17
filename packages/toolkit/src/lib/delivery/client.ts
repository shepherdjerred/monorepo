import { createDeliveryClient } from "@shepherdjerred/delivery/client";

export function deliveryUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Delivery URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  }
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Delivery requires HTTPS outside localhost");
  }
  return url.toString().replace(/\/$/u, "");
}

export function deliveryClient(url: string, token?: string) {
  return createDeliveryClient({
    baseUrl: deliveryUrl(url),
    ...(token === undefined
      ? {}
      : { headers: { Authorization: `Bearer ${token}` } }),
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      }),
  });
}
