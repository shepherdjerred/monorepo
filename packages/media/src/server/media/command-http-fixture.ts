import { commandFixture } from "#infrastructure/editions/command-test-support.ts";
import { createFixtureLifecycle } from "#testing/fixture-lifecycle.ts";

/** HTTP scenarios retain their own authentication and request assertions. */
export async function commandHttpFixture() {
  const { db, close } = await createFixtureLifecycle();
  try {
    return { db, f: await commandFixture(db), close };
  } catch (error) {
    await close();
    throw error;
  }
}
