import type {
  Anchor,
  CommentView,
  FeedbackItem,
} from "@shepherdjerred/artifacts/contract";
import { redactTokens } from "./errors.ts";

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${String(minutes)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Where a thread points, in a few words an agent can act on. */
export function anchorSummary(anchor: Anchor): string {
  switch (anchor.type) {
    case "general":
      return "general comment";
    case "board":
      return `board point (${String(Math.round(anchor.x))}, ${String(Math.round(anchor.y))})`;
    case "frame":
      return `frame at ${percent(anchor.x)} across, ${percent(anchor.y)} down`;
    case "doc":
      return `${anchor.path} at ${percent(anchor.x)} across, ${String(Math.round(anchor.y))}px down`;
    case "page":
      return `page ${String(anchor.page)} at ${percent(anchor.x)} across, ${percent(anchor.y)} down`;
    case "time":
      return anchor.x === undefined || anchor.y === undefined
        ? `${clock(anchor.t)} in the recording`
        : `${clock(anchor.t)} in the recording at ${percent(anchor.x)} across, ${percent(anchor.y)} down`;
  }
}

/** Quote a body so reviewer text can never read as part of the digest's own structure. */
function quote(text: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

function comment(entry: CommentView): string {
  return `${quote(entry.body)}\n> — ${entry.author.name}, ${entry.createdAt}`;
}

function versionNote(item: FeedbackItem): string {
  const artifact = item.artifact;
  if (artifact === null) return "";
  if (artifact.commentedOnVersion === null)
    return ` v${String(artifact.currentVersion)}`;
  return artifact.commentedOnVersion === artifact.currentVersion
    ? ` v${String(artifact.commentedOnVersion)}`
    : ` v${String(artifact.commentedOnVersion)} (now v${String(artifact.currentVersion)})`;
}

function itemDigest(item: FeedbackItem): string {
  const title = item.artifact?.title ?? "Board";
  const lines = [
    `### ${title}${versionNote(item)} · ${anchorSummary(item.thread.anchor)} · thread ${item.thread.id}`,
    "",
    comment(item.comment),
  ];
  if (item.thread.priorComments.length > 0) {
    lines.push("", "Earlier in this thread:");
    for (const prior of item.thread.priorComments)
      lines.push("", comment(prior));
  }
  lines.push("", `Review: ${item.reviewUrl}`);
  lines.push(
    `Reply: \`toolkit artifacts reply ${item.thread.id} --body-file <file> --resolve\``,
  );
  if (item.artifact !== null)
    lines.push(
      `Publish the fix: \`toolkit artifacts publish <path> --version-of ${item.artifact.id}\``,
    );
  return lines.join("\n");
}

/**
 * The markdown `wait` prints: one block per human comment, then the one
 * instruction the agent needs to keep the review loop going.
 */
export function formatFeedbackDigest(items: readonly FeedbackItem[]): string {
  const count =
    items.length === 1 ? "1 comment" : `${String(items.length)} comments`;
  const body = [
    `# Review feedback: ${count}`,
    "",
    ...items.flatMap((item) => [itemDigest(item), ""]),
    "Next: hand each item to a subagent, publish the result as a new version with `toolkit artifacts publish <path> --version-of <artifactId>`, answer each thread with `toolkit artifacts reply <threadId> --body-file <file> --resolve`, then run `toolkit artifacts wait` again.",
    "",
  ].join("\n");
  return redactTokens(body);
}
