import { z } from "zod/v4";

const ProfileName = z.object({ name: z.string() });
export const ProfilesSchema = z.union([
  z.array(ProfileName),
  z.object({ profiles: z.array(ProfileName) }),
]);
const Instance = z.object({
  id: z.string(),
  profileName: z.string().optional(),
  mode: z.enum(["headed", "headless"]).optional(),
  headless: z.boolean().optional(),
});
export const InstancesSchema = z.union([
  z.array(Instance),
  z.object({ instances: z.array(Instance) }),
]);
const RejectedCreation = z.object({
  status: z.number().int().min(400).max(499),
});

const Profile = z.object({
  id: z.string().min(1),
  name: z.string(),
  running: z.boolean(),
});

export class PromotionBrowserProfile {
  readonly name: string | undefined;
  private readonly temporary: boolean;
  private created = false;

  constructor(options: { profile?: string; temporaryProfile?: true }) {
    if (options.temporaryProfile === true && options.profile !== undefined)
      throw new Error("Temporary profiles cannot reuse a supplied profile");
    this.temporary = options.temporaryProfile === true;
    this.name = this.temporary
      ? `storm-public-${crypto.randomUUID()}`
      : options.profile;
  }

  async prepare(
    name: string,
    profiles: { name: string }[],
    create: () => Promise<unknown>,
  ) {
    if (profiles.some((profile) => profile.name === name)) {
      if (this.temporary)
        throw new Error(
          "Anonymous profile already exists; refusing to reuse it",
        );
      return;
    }
    this.created = this.temporary;
    try {
      await create();
    } catch (error) {
      if (RejectedCreation.safeParse(error).success) this.created = false;
      throw error;
    }
  }

  async close(baseUrl: string, token: string) {
    if (!this.created) return false;
    if (this.name === undefined)
      throw new Error("Owned temporary profile is missing");
    await disposeTemporaryPromotionProfile({
      baseUrl,
      token,
      profile: this.name,
    });
    this.created = false;
    return true;
  }
}

/** Only the unpredictable anonymous profile created by this caller may be removed. */
export async function disposeTemporaryPromotionProfile(input: {
  baseUrl: string;
  token: string;
  profile: string;
}) {
  z.string()
    .regex(/^storm-public-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/)
    .parse(input.profile);
  // Task cancellation must not cancel cleanup of its own browser resources.
  const signal = AbortSignal.timeout(10_000);
  const request = async (suffix: string, method = "GET") => {
    const response = await fetch(`${input.baseUrl}${suffix}`, {
      method,
      headers: { authorization: `Bearer ${input.token}` },
      signal,
    });
    if (!response.ok && response.status !== 404)
      throw new Error(
        `Anonymous browser cleanup ${suffix} HTTP ${String(response.status)}`,
      );
    return response;
  };
  const read = async (key: string) => {
    const response = await request(`/profiles/${encodeURIComponent(key)}`);
    if (response.status === 404) return null;
    const profile = Profile.parse(await response.json());
    if (profile.name !== input.profile)
      throw new Error("Anonymous profile identity changed before cleanup");
    return profile;
  };
  const owned = await read(input.profile);
  if (owned === null) return;
  const resource = `/profiles/${encodeURIComponent(owned.id)}`;
  await request(`${resource}/stop`, "POST");
  const deadline = Date.now() + 5000;
  for (;;) {
    const current = await read(owned.id);
    if (current === null) return;
    if (current.id !== owned.id)
      throw new Error("Anonymous profile ID changed before cleanup");
    if (!current.running) break;
    if (Date.now() >= deadline)
      throw new Error("Anonymous browser instance did not finish stopping");
    await Bun.sleep(50);
  }
  // PinchTab's non-forced deletion also refuses a profile with an active holder.
  await request(resource, "DELETE");
  if ((await read(owned.id)) !== null)
    throw new Error("Anonymous profile deletion has no confirmed readback");
}
