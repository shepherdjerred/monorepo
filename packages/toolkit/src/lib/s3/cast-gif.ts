/**
 * Render asciinema recordings to animated GIFs with `agg`
 * (https://docs.asciinema.org/manual/agg/). GitHub cannot embed the
 * interactive player page, but it renders a GIF inline through its image
 * proxy, so `toolkit pr asset --markdown` shows the GIF and links it to the
 * player.
 */

export const AGG_INSTALL_HINT = "brew install agg";

/** Renders one `.cast` file to a GIF at `gifPath`, throwing on failure. */
export type CastGifRenderer = (
  castPath: string,
  gifPath: string,
) => Promise<void>;

export class CastGifRenderError extends Error {
  constructor(
    readonly castPath: string,
    detail: string,
  ) {
    super(`could not render a GIF from '${castPath}' with agg: ${detail}`);
    this.name = "CastGifRenderError";
  }
}

/**
 * agg argv for one recording. Idle gaps are capped at 2s so long pauses do
 * not stall the inline preview, and the final frame holds for 4s so the end
 * state is readable before the loop restarts. Font size, theme, and speed
 * stay at agg's defaults (16px, asciinema theme, 1x).
 */
export function aggArgv(
  executable: string,
  castPath: string,
  gifPath: string,
): string[] {
  return [
    executable,
    "--quiet",
    "--idle-time-limit",
    "2",
    "--last-frame-duration",
    "4",
    castPath,
    gifPath,
  ];
}

/** Default renderer: runs the `agg` binary from PATH. */
export async function renderCastGifWithAgg(
  castPath: string,
  gifPath: string,
): Promise<void> {
  const executable = Bun.which("agg");
  if (executable === null) {
    throw new CastGifRenderError(
      castPath,
      "agg is not installed or not on PATH",
    );
  }
  const child = Bun.spawn(aggArgv(executable, castPath, gifPath), {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    const trimmed = stderr.trim();
    throw new CastGifRenderError(
      castPath,
      `agg exited with code ${String(exitCode)}${trimmed.length > 0 ? `: ${trimmed}` : ""}`,
    );
  }
  const size = Bun.file(gifPath).size;
  if (size === 0) {
    throw new CastGifRenderError(castPath, "agg produced an empty GIF");
  }
}
