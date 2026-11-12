#!/usr/bin/env bun

// `sync` is dispatched before the picker is loaded: it is the only verb that
// runs on Windows, where the agent launcher and Ink picker have no meaning.
try {
  const args = process.argv.slice(2);
  if (args[0] === "sync") {
    const { handleSyncCommand } = await import("#commands/brim/sync.ts");
    process.exitCode = await handleSyncCommand(args.slice(1));
  } else if (args[0] === "capture") {
    // Agent wrappers run `brim capture env` on every launch: keep it off the
    // picker's import graph.
    const { handleCaptureCommand } = await import("#commands/brim/capture.ts");
    process.exitCode = await handleCaptureCommand(args.slice(1));
  } else {
    const { handleBrimCommand } = await import("#commands/brim/brim.ts");
    await handleBrimCommand(args);
  }
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
