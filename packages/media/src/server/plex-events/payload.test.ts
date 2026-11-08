import { expect, test } from "vitest";
import { projectPlexPayload, readPlexPayload } from "./payload.ts";

test("unsupported events do not require or retain unrelated payload fields", () => {
  expect(
    projectPlexPayload({ event: "library.new", Account: { id: 1 } }),
  ).toBeNull();
  expect(
    projectPlexPayload({ event: "media.play", Metadata: { type: "track" } }),
  ).toBeNull();
  expect(() => projectPlexPayload({ event: "media.play" })).toThrow(
    "Invalid event request",
  );
});

test("multipart reader handles tiny chunks, repeated parts, and invalid JSON without disclosing content", async () => {
  const request = new Request("http://localhost/events/plex", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
    body: '--fixture\r\nContent-Disposition: form-data; name="payload"\r\n\r\n{"event":"library.new"}\r\n--fixture--\r\n',
  });
  const bytes = new Uint8Array(await request.arrayBuffer());
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else {
        controller.enqueue(bytes.slice(offset, offset + 1));
        offset++;
      }
    },
  });
  expect(
    await readPlexPayload(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      }),
    ),
  ).toBeNull();
  const malformed = new FormData();
  malformed.set("payload", "synthetic-private-capability");
  await expect(
    readPlexPayload(
      new Request(request.url, { method: "POST", body: malformed }),
    ),
  ).rejects.toThrow("Invalid event request");
  const duplicateThumb = new FormData();
  duplicateThumb.set("payload", '{"event":"library.new"}');
  duplicateThumb.append("thumb", "first");
  duplicateThumb.append("thumb", "second");
  await expect(
    readPlexPayload(
      new Request(request.url, { method: "POST", body: duplicateThumb }),
    ),
  ).rejects.toThrow("Invalid event request");
});

test("external IDs never coerce unsafe or noncanonical numbers", () => {
  const base = {
    event: "media.play",
    Server: { uuid: "server" },
    Metadata: {
      type: "movie",
      librarySectionID: 1,
      ratingKey: "9223372036854775807",
    },
  };
  expect(projectPlexPayload(base)).toMatchObject({
    sectionId: "1",
    ratingKey: "9223372036854775807",
  });
  for (const ratingKey of [
    0,
    -1,
    1.2,
    Number.MAX_SAFE_INTEGER + 1,
    "01",
    "1e3",
    "1.0",
    "x".repeat(100),
  ])
    expect(() =>
      projectPlexPayload({
        ...base,
        Metadata: { ...base.Metadata, ratingKey },
      }),
    ).toThrow("Invalid event request");
});
