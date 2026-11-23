import path from "node:path";

/** Bundle the real Scout entrypoint while leaving the host's explicit fzstd URL intact. */
export async function buildCombatTimelineWorker(
  sourceRoot: string,
): Promise<BuildArtifact> {
  const replayWorkspace = path.resolve(
    sourceRoot,
    "../../../../packages/scout-for-lol/packages/replay",
  );
  const result = await Bun.build({
    entrypoints: [path.join(sourceRoot, "combat-timeline-worker.mjs")],
    target: "browser",
    format: "esm",
    external: ["/assets/vendor/fzstd.mjs"],
    plugins: [
      {
        name: "scout-replay-observations",
        setup(build) {
          build.onResolve(
            { filter: /^\/assets\/vendor\/fzstd\.mjs$/ },
            (args) => ({
              path: args.path,
              external: true,
            }),
          );
          build.onResolve(
            { filter: /^@scout-for-lol\/replay\/observations$/ },
            (args) => ({
              path: Bun.resolveSync(args.path, replayWorkspace),
            }),
          );
        },
      },
    ],
  });
  const artifact = result.outputs[0];
  if (!result.success || result.outputs.length !== 1 || artifact === undefined)
    throw new AggregateError(
      result.logs,
      "Scout replay observation worker bundle failed",
    );
  return artifact;
}
