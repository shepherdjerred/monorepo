// Isolated local integration fixture; no published ports or real S3 credentials.
const objects = new Map<string, Uint8Array>();
const uploads = new Map<string, Map<number, Uint8Array>>();
const xml = (body: string) =>
  new Response(body, { headers: { "Content-Type": "application/xml" } });
Bun.serve({
  hostname: "0.0.0.0",
  port: 19_001,
  async fetch(request) {
    const url = new URL(request.url);
    const key = url.pathname;
    if (request.method === "POST" && url.searchParams.has("uploads")) {
      const id = crypto.randomUUID();
      uploads.set(id, new Map());
      return xml(
        `<InitiateMultipartUploadResult><Bucket>roundtrip</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    const id = url.searchParams.get("uploadId");
    if (id !== null) {
      const parts = uploads.get(id);
      if (parts === undefined) {
        return new Response(null, { status: 404 });
      }
      if (request.method === "PUT") {
        parts.set(
          Number(url.searchParams.get("partNumber")),
          new Uint8Array(await request.arrayBuffer()),
        );
        return new Response(null, { headers: { ETag: '"test-part"' } });
      }
      if (request.method === "POST") {
        const ordered = [...parts.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, body]) => body);
        objects.set(key, new Uint8Array(await new Blob(ordered).arrayBuffer()));
        uploads.delete(id);
        return xml(
          `<CompleteMultipartUploadResult><Location>${key}</Location><Bucket>roundtrip</Bucket><Key>${key}</Key><ETag>"test-object"</ETag></CompleteMultipartUploadResult>`,
        );
      }
      if (request.method === "DELETE") {
        uploads.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    if (request.method === "PUT") {
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { headers: { ETag: '"test-object"' } });
    }
    const body = objects.get(key);
    if (body === undefined) {
      return new Response("<Error><Code>NoSuchKey</Code></Error>", {
        status: 404,
        headers: { "Content-Type": "application/xml" },
      });
    }
    return new Response(request.method === "HEAD" ? null : body, {
      headers: { "Content-Length": String(body.byteLength) },
    });
  },
});
