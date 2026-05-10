import type { ExtendedProgress } from "./types.ts";

/** Options for the progress display */
export type ProgressDisplayOptions = {
  /** Suppress all progress output */
  quiet: boolean;
  /** Show progress bar */
  showBar: boolean;
  /** Show stats table */
  showStats: boolean;
  /** Terminal width (auto-detected if not specified) */
  width: number | undefined;
};

/** ANSI escape codes for terminal control */
const ANSI = {
  clearLine: "\u001B[2K",
  cursorUp: (n: number) => `\u001B[${String(n)}A`,
  cursorDown: (n: number) => `\u001B[${String(n)}B`,
  cursorToColumn: (n: number) => `\u001B[${String(n)}G`,
  hideCursor: "\u001B[?25l",
  showCursor: "\u001B[?25h",
  reset: "\u001B[0m",
  dim: "\u001B[2m",
  bold: "\u001B[1m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  cyan: "\u001B[36m",
};

/** Box drawing characters */
const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  filled: "━",
  empty: "░",
};

/** Progress display class for rich terminal output */
export class ProgressDisplay {
  private readonly options: ProgressDisplayOptions;
  private readonly startTime: number;
  private lastUpdateTime: number;
  private readonly speeds: number[] = [];
  private linesWritten = 0;
  private readonly isTTY: boolean;
  private readonly width: number;
  private lastProgress: ExtendedProgress | null = null;

  constructor(options: Partial<ProgressDisplayOptions> = {}) {
    this.options = {
      quiet: options.quiet ?? false,
      showBar: options.showBar ?? true,
      showStats: options.showStats ?? true,
      width: options.width,
    };
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.isTTY = process.stdout.isTTY;
    this.width = options.width ?? process.stdout.columns;

    // Hide cursor during progress display
    if (this.isTTY && !this.options.quiet) {
      process.stdout.write(ANSI.hideCursor);
    }
  }

  /** Update the progress display */
  update(progress: ExtendedProgress): void {
    if (this.options.quiet) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.startTime;

    // Calculate speed (functions per second)
    if (progress.current > 0 && this.lastProgress) {
      const timeDiff = (now - this.lastUpdateTime) / 1000;
      const funcDiff = progress.current - this.lastProgress.current;
      if (timeDiff > 0 && funcDiff > 0) {
        const speed = funcDiff / timeDiff;
        this.speeds.push(speed);
        // Keep rolling window of last 10 speeds
        if (this.speeds.length > 10) {
          this.speeds.shift();
        }
      }
    }

    this.lastUpdateTime = now;
    this.lastProgress = progress;

    // Calculate average speed
    const avgSpeed =
      this.speeds.length > 0
        ? this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length
        : 0;

    // Calculate ETA
    const remaining = progress.total - progress.current;
    const eta = avgSpeed > 0 ? remaining / avgSpeed : 0;

    if (this.isTTY) {
      this.renderTTY(progress, elapsed, avgSpeed, eta);
    } else {
      this.renderSimple(progress);
    }
  }

  /** Render rich TTY output with progress bar and stats */
  private renderTTY(
    progress: ExtendedProgress,
    elapsed: number,
    speed: number,
    eta: number,
  ): void {
    // Clear previous output
    if (this.linesWritten > 0) {
      process.stdout.write(ANSI.cursorUp(this.linesWritten));
    }

    const lines: string[] = [];

    // Header line
    if (progress.currentItem != null && progress.currentItem.length > 0) {
      lines.push(
        `${ANSI.clearLine}${ANSI.bold}De-minifying:${ANSI.reset} ${progress.currentItem}`,
      );
    }

    // Progress bar
    if (this.options.showBar) {
      const barLine = this.renderProgressBar(progress.current, progress.total);
      lines.push(`${ANSI.clearLine}${barLine}`);

      // Speed/ETA line
      const speedStr = speed > 0 ? `${speed.toFixed(1)} fn/s` : "-- fn/s";
      const etaStr = eta > 0 ? this.formatDuration(eta * 1000) : "--:--";
      const elapsedStr = this.formatDuration(elapsed);
      lines.push(
        `${ANSI.clearLine}${ANSI.dim}Speed: ${speedStr} │ ETA: ${etaStr} │ Elapsed: ${elapsedStr}${ANSI.reset}`,
      );
    }

    // Stats table
    if (this.options.showStats) {
      lines.push(ANSI.clearLine);
      lines.push(...this.renderStatsTable(progress));
    }

    // Write all lines
    for (const line of lines) {
      process.stdout.write(line + "\n");
    }

    this.linesWritten = lines.length;
  }

  /** Render the progress bar */
  private renderProgressBar(current: number, total: number): string {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const barWidth = Math.min(40, this.width - 25);
    const filled = Math.round((current / total) * barWidth);
    const empty = barWidth - filled;

    const bar =
      ANSI.green +
      BOX.filled.repeat(filled) +
      ANSI.reset +
      ANSI.dim +
      BOX.empty.repeat(empty) +
      ANSI.reset;

    return `${bar} ${percent.toString().padStart(3)}% │ ${String(current)}/${String(total)} functions`;
  }

  /** Render the stats table */
  private renderStatsTable(progress: ExtendedProgress): string[] {
    const lines: string[] = [];
    const tableWidth = Math.min(45, this.width - 2);
    const innerWidth = tableWidth - 2;

    // Top border
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.topLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.topRight}${ANSI.reset}`,
    );

    // Cache line
    const cacheTotal = progress.cacheHits + progress.cacheMisses;
    const cacheRate =
      cacheTotal > 0 ? Math.round((progress.cacheHits / cacheTotal) * 100) : 0;
    const cacheLine = `Cache:     ${String(progress.cacheHits)} hits │ ${String(progress.cacheMisses)} misses │ ${String(cacheRate)}%`;
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.vertical}${ANSI.reset} ${cacheLine.padEnd(innerWidth - 1)}${ANSI.dim}${BOX.vertical}${ANSI.reset}`,
    );

    // Tokens line
    const tokensLine = `Tokens:    ${this.formatNumber(progress.inputTokens)} in │ ${this.formatNumber(progress.outputTokens)} out`;
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.vertical}${ANSI.reset} ${tokensLine.padEnd(innerWidth - 1)}${ANSI.dim}${BOX.vertical}${ANSI.reset}`,
    );

    // Errors line
    const errorsLine = `Errors:    ${String(progress.errors)}`;
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.vertical}${ANSI.reset} ${errorsLine.padEnd(innerWidth - 1)}${ANSI.dim}${BOX.vertical}${ANSI.reset}`,
    );

    // Confidence line
    const confLine = `Avg Conf:  ${progress.avgConfidence > 0 ? progress.avgConfidence.toFixed(2) : "--"}`;
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.vertical}${ANSI.reset} ${confLine.padEnd(innerWidth - 1)}${ANSI.dim}${BOX.vertical}${ANSI.reset}`,
    );

    // Bottom border
    lines.push(
      `${ANSI.clearLine}${ANSI.dim}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.bottomRight}${ANSI.reset}`,
    );

    return lines;
  }

  /** Render simple non-TTY output */
  private renderSimple(progress: ExtendedProgress): void {
    const percent =
      progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;
    const line = `[${String(percent)}%] ${progress.phase}: ${String(progress.current)}/${String(progress.total)} - ${progress.currentItem ?? ""}`;
    console.log(line);
  }

  /** Format duration in mm:ss or Xm Ys format */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${String(minutes)}m ${String(remainingSeconds)}s`;
    }
    return `${String(remainingSeconds)}s`;
  }

  /** Format large numbers with commas */
  private formatNumber(n: number): string {
    return n.toLocaleString();
  }

  /** Clear the progress display and show cursor */
  clear(): void {
    if (this.options.quiet) {
      return;
    }

    if (this.isTTY) {
      // Show cursor again
      process.stdout.write(ANSI.showCursor);

      // Clear the progress lines
      if (this.linesWritten > 0) {
        process.stdout.write(ANSI.cursorUp(this.linesWritten));
        for (let i = 0; i < this.linesWritten; i++) {
          process.stdout.write(ANSI.clearLine + "\n");
        }
        process.stdout.write(ANSI.cursorUp(this.linesWritten));
      }
    }

    this.linesWritten = 0;
  }

  /** Finalize and print final stats */
  finish(progress: ExtendedProgress): void {
    if (this.options.quiet) {
      return;
    }

    this.clear();

    const elapsed = Date.now() - this.startTime;
    const speed =
      progress.current > 0 ? progress.current / (elapsed / 1000) : 0;

    console.log(`${ANSI.green}✓${ANSI.reset} De-minification complete`);
    console.log(`  Functions: ${String(progress.current)}`);
    console.log(
      `  Cache: ${String(progress.cacheHits)} hits, ${String(progress.cacheMisses)} misses`,
    );
    console.log(
      `  Tokens: ${this.formatNumber(progress.inputTokens)} in, ${this.formatNumber(progress.outputTokens)} out`,
    );
    console.log(
      `  Time: ${this.formatDuration(elapsed)} (${speed.toFixed(1)} fn/s)`,
    );
    if (progress.errors > 0) {
      console.log(
        `  ${ANSI.yellow}Errors: ${String(progress.errors)}${ANSI.reset}`,
      );
    }

    // Show cursor
    if (this.isTTY) {
      process.stdout.write(ANSI.showCursor);
    }
  }
}

/** Create a callback function for use with Deminifier */
export function createProgressCallback(
  display: ProgressDisplay,
): (progress: ExtendedProgress) => void {
  return (progress) => {
    display.update(progress);
  };
}
