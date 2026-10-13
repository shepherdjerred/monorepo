import { z } from "zod";
import { docker } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import { paperJarName } from "@shepherdjerred/mc-harness/sandbox/artifacts.ts";
import { thirdPartyPlugins } from "#e2e/harness/pins.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const FileIdentity = z.strictObject({ file: z.string().min(1), sha256: Hash });
const propertiesIdentity =
  "server.properties (without comments or rcon.password)";
export const requiredRuntimeSettings = [
  "bukkit.yml",
  "spigot.yml",
  "config/paper-global.yml",
  "config/paper-world-defaults.yml",
  "plugins/Citizens/config.yml",
  propertiesIdentity,
] as const;
const WorldOverrides = z.strictObject({
  status: z.enum(["absent", "present"]),
  files: z.array(
    FileIdentity.extend({
      file: z
        .string()
        .min(1)
        .refine(
          (file) =>
            file.split("/").at(-1) === "paper-world.yml" &&
            !file.startsWith("/") &&
            !file.split("/").includes(".."),
        ),
    }),
  ),
});
export const RuntimeSchema = z
  .strictObject({
    serverImage: z.string().min(1),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    paperSha256: Hash,
    paperRuntimeSha256: Hash,
    javaExecutableSha256: Hash,
    javaReleaseSha256: Hash,
    javaArgumentsSha256: Hash,
    plugins: z.array(FileIdentity).min(1),
    settings: z.array(FileIdentity).min(1),
    worldOverrides: WorldOverrides,
  })
  .superRefine((runtime, context) => {
    for (const field of ["plugins", "settings"] as const) {
      if (
        new Set(runtime[field].map((entry) => entry.file)).size !==
        runtime[field].length
      )
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Duplicate runtime input",
        });
    }
    const actualPlugins = new Map(
      runtime.plugins.map((entry) => [entry.file, entry.sha256]),
    );
    if (
      actualPlugins.size !== thirdPartyPlugins.length ||
      thirdPartyPlugins.some(
        (plugin) =>
          actualPlugins.get(`${plugin.name}-${plugin.version}.jar`) !==
          plugin.sha256,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["plugins"],
        message: "Incomplete or changed pinned runtime plugin inventory",
      });
    const settings = new Set(runtime.settings.map((entry) => entry.file));
    if (
      settings.size !== requiredRuntimeSettings.length ||
      requiredRuntimeSettings.some((file) => !settings.has(file))
    )
      context.addIssue({
        code: "custom",
        path: ["settings"],
        message: "Incomplete required runtime settings inventory",
      });
    const overrides = runtime.worldOverrides;
    if (
      (overrides.status === "absent") !== (overrides.files.length === 0) ||
      new Set(overrides.files.map((entry) => entry.file)).size !==
        overrides.files.length
    )
      context.addIssue({
        code: "custom",
        path: ["worldOverrides"],
        message: "Contradictory world override inventory",
      });
  });

/** Canonical declared identities are rehashed when qualifying an original report. */
export function runtimeFingerprint(value: unknown): string {
  const runtime = RuntimeSchema.parse(value);
  const canonical = {
    ...runtime,
    plugins: [...runtime.plugins].sort((a, b) => a.file.localeCompare(b.file)),
    settings: [...runtime.settings].sort((a, b) =>
      a.file.localeCompare(b.file),
    ),
    worldOverrides: {
      ...runtime.worldOverrides,
      files: [...runtime.worldOverrides.files].sort((a, b) =>
        a.file.localeCompare(b.file),
      ),
    },
  };
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export async function stagedDigest(
  containerId: string,
  filename: string,
): Promise<string> {
  const copied = await docker(["exec", containerId, "sha256sum", filename]);
  return Hash.parse(copied.stdout.split(/\s+/u)[0]);
}

/** Compare actual staged binaries and the running JVM without returning credentials or arguments. */
export async function runtimeIdentity(containerId: string) {
  const inspected = await docker([
    "inspect",
    "--format",
    '{"imageId":{{json .Image}},"serverImage":{{json .Config.Image}}}',
    containerId,
  ]);
  const image = z
    .strictObject({
      imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      serverImage: z.literal(serverImage),
    })
    .parse(JSON.parse(inspected.stdout));
  const actualPaper = await stagedDigest(containerId, `/data/${paperJarName}`);
  if (actualPaper !== paper.sha256)
    throw new Error("Staged Paper differs from its pinned build");
  const plugins = await Promise.all(
    thirdPartyPlugins.map(async (plugin) => {
      const file = `${plugin.name}-${plugin.version}.jar`;
      const sha256 = await stagedDigest(containerId, `/data/plugins/${file}`);
      if (sha256 !== plugin.sha256)
        throw new Error(`Staged runtime plugin differs: ${plugin.name}`);
      return { file, sha256 };
    }),
  );
  const jvm = await docker([
    "exec",
    "-u",
    "1000",
    containerId,
    "sh",
    "-c",
    `
set -eu
count=0
for candidate in /proc/[0-9]*/exe; do
  candidate_executable=$(readlink -f "$candidate") || continue
  case "$candidate_executable" in
    */bin/java)
      count=$((count + 1))
      jvm_pid=\${candidate#/proc/}
      jvm_pid=\${jvm_pid%/exe}
      jvm_executable=$candidate_executable
      ;;
  esac
done
[ "$count" -eq 1 ] || exit 1
sha256sum "$jvm_executable"
sha256sum "$(dirname "$(dirname "$jvm_executable")")/release"
tr '\\000' '\\n' < "/proc/$jvm_pid/cmdline" | sed '/^-XX:ActiveProcessorCount=/d' | sha256sum
`,
  ]);
  const hashes = z
    .array(Hash)
    .length(3)
    .parse(
      jvm.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/\s+/u)[0]),
    );
  const settings: z.infer<typeof FileIdentity>[] = await Promise.all(
    requiredRuntimeSettings
      .filter((file) => file !== propertiesIdentity)
      .map(async (file) => ({
        file,
        sha256: await stagedDigest(containerId, `/data/${file}`),
      })),
  );
  // A generated comment and the per-run RCON credential do not change simulation behavior.
  const properties = await docker([
    "exec",
    containerId,
    "sh",
    "-c",
    "sed -e '/^#/d' -e '/^rcon.password=/d' -e '/^$/d' /data/server.properties | LC_ALL=C sort | sha256sum",
  ]);
  settings.push({
    file: propertiesIdentity,
    sha256: Hash.parse(properties.stdout.split(/\s+/u)[0]),
  });
  // Inventory every per-world override, including explicit absence. A failed scan fails closed.
  const inventory = await docker([
    "exec",
    containerId,
    "find",
    "/data",
    "-name",
    "paper-world.yml",
    "-type",
    "f",
    "-print",
  ]);
  const worldFiles =
    inventory.stdout.trim() === ""
      ? []
      : inventory.stdout.trim().split("\n").sort();
  const overrides = await Promise.all(
    worldFiles.map(async (file) => {
      if (!file.startsWith("/data/"))
        throw new Error("World override is outside the staged server");
      return {
        file: file.slice("/data/".length),
        sha256: await stagedDigest(containerId, file),
      };
    }),
  );
  const runtime = RuntimeSchema.parse({
    ...image,
    paperSha256: actualPaper,
    paperRuntimeSha256: await stagedDigest(
      containerId,
      `/data/versions/${paper.version}/paper-${paper.version}.jar`,
    ),
    javaExecutableSha256: hashes[0],
    javaReleaseSha256: hashes[1],
    javaArgumentsSha256: hashes[2],
    plugins,
    settings,
    worldOverrides: {
      status: overrides.length === 0 ? "absent" : "present",
      files: overrides,
    },
  });
  return { runtime, runtimeSha256: runtimeFingerprint(runtime) };
}
