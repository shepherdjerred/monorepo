import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { FetchTransport } from "./http.ts";

/** Node fetch ignores Host overrides. Postal's internal service requires its virtual host. */
export const postalHttp: FetchTransport = async (url, init) => {
  if (typeof init.body !== "string")
    throw new TypeError("Postal requires a JSON string body");
  const body = init.body;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise<Response>((resolve, reject) => {
    const request = send(
      url,
      {
        method: "POST",
        headers: Object.fromEntries(new Headers(init.headers)),
        ...(init.signal === null || init.signal === undefined
          ? {}
          : { signal: init.signal }),
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 1024 * 1024) {
            response.destroy(new Error("Postal response exceeds bounds"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = response.statusCode;
          if (status === undefined || status < 200 || status > 599) {
            reject(new Error("Postal returned invalid response status"));
            return;
          }
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
};
