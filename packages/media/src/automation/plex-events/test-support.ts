import { automationTestHarness } from "#testing/automation.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { defaultScope } from "#shared/editions/scope.ts";

export function watchHarness() {
  const harness = automationTestHarness();
  let sequence = 1000;
  async function credential(user: { id: string; plexAccountId: string }) {
    return await harness.database().credential.create({
      data: {
        userId: user.id,
        kind: "plex",
        ciphertext: harness.cipher.encrypt(
          JSON.stringify({ serverToken: user.id }),
          `plex:${user.plexAccountId}`,
        ),
      },
    });
  }
  async function fixture() {
    const ratingKey = String(sequence++);
    const value = await harness.fixture(ratingKey);
    const token = await credential(value.user);
    const key = { userId: value.user.id, ...defaultScope(value.media.id) };
    await harness.database().watchState.create({
      data: {
        ...key,
        watched: true,
        observedAt: new Date(0),
        source: "plex_current",
      },
    });
    return { ...value, ratingKey, token, key };
  }
  async function requester(mediaId: string) {
    const user = await harness.database().mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Second requester",
      },
    });
    await grantTestRequesterAccess(
      harness.database(),
      user.id,
      "fixture-server",
    );
    await credential(user);
    await harness
      .database()
      .mediaRequest.create({ data: { userId: user.id, mediaId } });
    await harness.database().watchState.create({
      data: {
        userId: user.id,
        mediaId,
        watched: true,
        observedAt: new Date(0),
        source: "plex_current",
      },
    });
    return user;
  }
  return { ...harness, fixture, requester };
}

export function watchedTransport(watched: boolean): FetchTransport {
  return (url) =>
    Promise.resolve(
      Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ratingKey: url.pathname.split("/").at(-1),
              type: "movie",
              title: "Fixture",
              viewCount: watched ? 1 : 0,
            },
          ],
        },
      }),
    );
}

function uninitialized(): never {
  throw new Error("Barrier is uninitialized");
}
export function barrier() {
  let release: () => void = uninitialized;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export function pausedTransport(transport: FetchTransport) {
  const entered = barrier();
  const resume = barrier();
  return {
    entered: entered.promise,
    resume: resume.release,
    transport: async (...args: Parameters<FetchTransport>) => {
      entered.release();
      await resume.promise;
      return await transport(...args);
    },
  };
}
