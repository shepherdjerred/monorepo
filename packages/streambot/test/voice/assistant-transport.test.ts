import { describe, expect, test } from "vitest";
import { AssistantTransport } from "@shepherdjerred/streambot/streamer/assistant-transport.ts";
import type { AssistantAudioPort } from "@shepherdjerred/streambot/streamer/audio-ports.ts";

function fakePort(over: Partial<AssistantAudioPort> = {}): AssistantAudioPort {
  return {
    send: () => Promise.resolve(),
    setSpeaking: () => {
      /* the default fake records nothing; tests that care override it */
    },
    close: () => {
      /* the default fake records nothing; tests that care override it */
    },
    ...over,
  };
}

const PACKET = new Uint8Array([1, 2, 3]);

describe("AssistantTransport", () => {
  test("opens one port and reuses it across packets", () => {
    let opened = 0;
    const transport = new AssistantTransport(() => {
      opened += 1;
      return fakePort();
    });
    transport.send(PACKET);
    transport.send(PACKET);
    void transport.setSpeaking(true);
    // The speaking claim and the mixer's assistant queue are per connection, so a port per packet
    // would thrash both — and the claim that keeps the green ring lit through a song has to
    // outlive any single reply.
    expect(opened).toBe(1);
  });

  test("rethrows a delivery failure from the next send", async () => {
    const transport = new AssistantTransport(() =>
      fakePort({ send: () => Promise.reject(new Error("connection gone")) }),
    );
    // The first send cannot throw: the shared pipeline's transport returns void, so the rejection
    // has not happened yet when this returns.
    transport.send(PACKET);
    await Promise.resolve();
    await Promise.resolve();
    // It must surface on the next one. `PacedAssistantSender` decides a reply failed by catching a
    // synchronous throw here; swallowing it would let it count a reply nobody heard as delivered.
    expect(() => {
      transport.send(PACKET);
    }).toThrow("connection gone");
  });

  test("reports a failure exactly once", async () => {
    let attempt = 0;
    const transport = new AssistantTransport(() =>
      fakePort({
        send: () => {
          attempt += 1;
          return attempt === 1
            ? Promise.reject(new Error("first frame lost"))
            : Promise.resolve();
        },
      }),
    );
    transport.send(PACKET);
    await Promise.resolve();
    await Promise.resolve();
    expect(() => {
      transport.send(PACKET);
    }).toThrow("first frame lost");
    // A latched failure that never cleared would fail every subsequent reply on the connection.
    await Promise.resolve();
    expect(() => {
      transport.send(PACKET);
    }).not.toThrow();
  });

  test("a healthy send never throws", async () => {
    const sent: Uint8Array[] = [];
    const transport = new AssistantTransport(() =>
      fakePort({
        send: (opus) => {
          sent.push(opus);
          return Promise.resolve();
        },
      }),
    );
    // The control: the failure path must not fire on the happy path, or every reply would abort
    // after its second packet while the tests above still passed.
    transport.send(PACKET);
    await Promise.resolve();
    expect(() => {
      transport.send(PACKET);
    }).not.toThrow();
    expect(sent).toHaveLength(2);
  });

  test("a tail failure does not fail the next reply", async () => {
    let fail = true;
    const transport = new AssistantTransport(() =>
      fakePort({
        send: () =>
          fail
            ? Promise.reject(new Error("tail packet lost"))
            : Promise.resolve(),
      }),
    );
    // A reply whose LAST packet fails has no later send of its own to surface the latch through.
    void transport.setSpeaking(true);
    transport.send(PACKET);
    await Promise.resolve();
    await Promise.resolve();
    // The end boundary is the last moment this failure can be attributed to the reply that caused
    // it, and `PacedAssistantSender` awaits exactly this call — so it reports there.
    await expect(transport.setSpeaking(false)).rejects.toThrow(
      "tail packet lost",
    );

    // The next reply is healthy and must not inherit the previous one's failure.
    fail = false;
    await expect(transport.setSpeaking(true)).resolves.toBeUndefined();
    expect(() => {
      transport.send(PACKET);
    }).not.toThrow();
  });

  test("releasing the flag after a clean reply does not reject", async () => {
    const transport = new AssistantTransport(() => fakePort());
    await transport.setSpeaking(true);
    transport.send(PACKET);
    await Promise.resolve();
    // The control: an end boundary that always rejected would fail every reply while the
    // tail-failure test above stayed green.
    await expect(transport.setSpeaking(false)).resolves.toBeUndefined();
  });

  test("reset closes the port and clears a pending failure", async () => {
    let closed = 0;
    const transport = new AssistantTransport(() =>
      fakePort({
        send: () => Promise.reject(new Error("connection gone")),
        close: () => {
          closed += 1;
        },
      }),
    );
    transport.send(PACKET);
    await Promise.resolve();
    await Promise.resolve();
    transport.reset();
    expect(closed).toBe(1);
    // A torn-down connection is not a failure to report into the next reply, which opens a fresh
    // port against a fresh connection.
    expect(() => {
      transport.send(PACKET);
    }).not.toThrow();
  });
});
