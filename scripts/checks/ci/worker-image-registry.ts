import { z } from "zod";

type Executor = (command: readonly string[]) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;
async function execute(command: readonly string[]) {
  const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const ImageSchema = z.object({
  config: z.object({ Env: z.array(z.string()) }),
});
const GitShaSchema = z.string().regex(/^[a-f\d]{40}$/u);

export function imageGitSha(input: unknown): string {
  const single = ImageSchema.safeParse(input);
  const platforms = single.success
    ? [single.data]
    : Object.values(z.record(z.string(), ImageSchema).parse(input));
  const commits = new Set(
    platforms.map((image) =>
      GitShaSchema.parse(
        image.config.Env.find((value) => value.startsWith("GIT_SHA="))?.slice(
          "GIT_SHA=".length,
        ),
      ),
    ),
  );
  if (commits.size !== 1)
    throw new Error("Worker image platforms do not have one coherent GIT_SHA");
  const [commit] = commits;
  if (commit === undefined) throw new Error("Worker image has no GIT_SHA");
  return commit;
}

/** Docker owns native/CI registry authentication; this checker never reads tokens. */
export async function bakedGitSha(
  repository: string,
  digest: string,
  executor: Executor = execute,
): Promise<string> {
  const result = await executor([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    `docker.io/${repository}@${digest}`,
    "--format",
    "{{json .Image}}",
  ]);
  if (result.exitCode !== 0)
    throw new Error(`Could not inspect worker image ${repository}@${digest}`);
  const config: unknown = JSON.parse(result.stdout);
  return imageGitSha(config);
}

export async function digestForCommitTag(
  repository: string,
  gitSha: string,
  executor: Executor = execute,
): Promise<string | undefined> {
  const image = `docker.io/${repository}:candidate-${gitSha}`;
  const result = await executor([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    image,
    "--format",
    "{{json .Manifest}}",
  ]);
  if (result.exitCode !== 0) {
    if (
      /manifest[ _]unknown|name[ _]unknown|404 Not Found/iu.test(
        result.stderr,
      ) ||
      result.stderr.includes(`${image}: not found`)
    )
      return undefined;
    throw new Error(`Could not inspect worker commit tag ${image}`);
  }
  const manifest: unknown = JSON.parse(result.stdout);
  return z
    .object({ digest: z.string().regex(/^sha256:[a-f\d]{64}$/u) })
    .parse(manifest).digest;
}
