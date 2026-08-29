import { z } from "zod";

const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  running: z.boolean(),
});
const InstanceSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  url: z.url(),
  status: z.string(),
});
const BrowserLocationSchema = z.object({
  url: z.url(),
});

async function runPinchTabJson(args: readonly string[]): Promise<unknown> {
  const child = Bun.spawn(["pinchtab", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`PinchTab preflight failed: ${stderr.trim()}`);
  }
  const parsed: unknown = JSON.parse(stdout);
  return parsed;
}

export async function verifyPinchTabProfile(
  profileName: string,
  guildId: string,
  channelId: string,
): Promise<void> {
  const profiles = z
    .array(ProfileSchema)
    .parse(await runPinchTabJson(["profiles", "--json"]));
  const profile = profiles.find((candidate) => candidate.name === profileName);
  if (profile === undefined) {
    throw new Error(
      `PinchTab profile ${profileName} does not exist; create it and sign into Discord once`,
    );
  }
  if (!profile.running) {
    throw new Error(
      `PinchTab profile ${profileName} is not running; start its signed-in instance before smoke testing`,
    );
  }
  const instances = z
    .array(InstanceSchema)
    .parse(await runPinchTabJson(["instance", "list", "--json"]));
  const instance = instances.find(
    (candidate) =>
      candidate.profileId === profile.id && candidate.status === "running",
  );
  if (instance === undefined) {
    throw new Error(
      `PinchTab profile ${profileName} has no running browser instance`,
    );
  }

  const channelUrl = `https://discord.com/channels/${guildId}/${channelId}`;
  await runPinchTabJson([
    "nav",
    "--server",
    instance.url,
    channelUrl,
    "--json",
  ]);
  const location = BrowserLocationSchema.parse(
    await runPinchTabJson(["url", "--server", instance.url, "--json"]),
  );
  if (new URL(location.url).pathname.startsWith("/login")) {
    throw new Error(
      `PinchTab profile ${profileName} is not signed into Discord; complete the one-time browser login before smoke testing`,
    );
  }
  if (location.url !== channelUrl) {
    throw new Error(
      `PinchTab profile ${profileName} could not open the smoke channel; reached ${location.url}`,
    );
  }
}
