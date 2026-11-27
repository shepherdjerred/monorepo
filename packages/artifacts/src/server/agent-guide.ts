import { z } from "zod";
import { ALLOWED_CDN_ORIGINS } from "#shared/contract.ts";

/** Bumped whenever the guide changes in a way an agent must re-read. */
export const GUIDE_VERSION = 1;

export const GUIDE_REFERENCES = [
  "publishing",
  "concepts",
  "review-loop",
  "sandbox",
] as const;
export const GuideReferenceSchema = z.enum(GUIDE_REFERENCES);
export type GuideReference = z.infer<typeof GuideReferenceSchema>;

export type GuideLimits = {
  maxFileBytes: number;
  maxVersionBytes: number;
  maxFiles: number;
  feedbackSettleSeconds: number;
  boardIdleDays: number;
  archiveGraceDays: number;
};

const MIB = 1024 * 1024;
const mib = (bytes: number) => `${String(Math.round(bytes / MIB))} MiB`;

function skill(limits: GuideLimits): string {
  return `---
name: artifacts
description: Show Jerred work and get feedback on it. Use whenever you have something to review: a plan, a design, concepts, a demo, a recording, a diagram.
---

# Artifacts

Publish real files to a review board, give Jerred the review URL, then wait for
the comments he pins to them.

1. Publish: \`toolkit artifacts publish <path...>\`. Give the printed review URL to Jerred first.
2. Wait, with exactly one command: \`toolkit artifacts wait\`. It prints comments as they arrive and exits.
3. Delegate each fix to a subagent. Publish a new version (\`--version-of <id>\`), answer with
   \`toolkit artifacts reply <thread> --body-file <file> --resolve\`, then \`toolkit artifacts wait\` again.

Read the references only when you need them:

- \`/agent/reference/publishing.md\`: flags, kinds, boards, versions, limits.
- \`/agent/reference/concepts.md\`: two or three labelled concepts side by side.
- \`/agent/reference/review-loop.md\`: wait, delivery, replies, resolving.
- \`/agent/reference/sandbox.md\`: what a published page may and may not do.

Limits: ${mib(limits.maxFileBytes)} per file, ${mib(limits.maxVersionBytes)} per version, ${String(limits.maxFiles)} files.
Boards expire ${String(limits.boardIdleDays)} days after their last activity, or ${String(limits.archiveGraceDays)} days after
archiving, unless kept. \`toolkit artifacts guide\` prints this guide.
`;
}

function publishing(limits: GuideLimits): string {
  return `# Publishing

\`\`\`
toolkit artifacts publish <path...> [--board <slug>] [--title T] [--note-file F]
    [--label A|B|C] [--viewport 1440x900] [--version-of <id>] [--json]
\`\`\`

- Publish the real file: the HTML page, the built site directory, the PDF, the MP4, the \`.cast\`,
  the \`.mmd\`. Do not paste content into a message instead.
- One path publishes one artifact. A directory publishes one site; its entry is \`index.html\`.
- A single-artifact publish prints a review URL (\`/a/<id>\`). Several artifacts or \`--board\` print a
  board URL (\`/b/<slug>\`). Give Jerred the URL first, before anything else.
- \`--board\` names the board (created when absent). Use one board per topic, not one per file.
- \`--version-of <id>\` publishes a new version of an existing artifact. Comments on older versions
  stay on those versions and show as "on v1".
- \`--note-file\` is a short markdown note shown with the version: what changed, what to look at.
- \`--viewport WxH\` fixes the size an HTML page is shown at. Set it for every UI concept.
- The kind follows the entry file: html, site, image, video, pdf, markdown, cast (\`.cast\`),
  mermaid (\`.mmd\`), or file (a download).
- Re-running the same publish resends only the missing files.

Limits: ${mib(limits.maxFileBytes)} per file, ${mib(limits.maxVersionBytes)} per version, ${String(limits.maxFiles)} files per version.
Paths must be relative, with no \`..\`, no backslashes and no leading underscore.
`;
}

function concepts(): string {
  return `# Concepts

When asked for options, publish two or three concepts to one board, side by side.

- Publish each as its own artifact on the same board: \`--board <slug> --label A\`, then B, then C.
- Give every concept the same \`--viewport\` so they compare fairly (390x844 for mobile, 1440x900
  for desktop).
- Keep concepts different in kind, not in colour. Say in the note what each one bets on.
- Make each concept self-contained and viewable on its own: no shared state between them.
- Do not publish a fourth. Jerred picks one; publish the next version of that one.
`;
}

function reviewLoop(limits: GuideLimits): string {
  return `# The review loop

\`\`\`
toolkit artifacts wait [--board <slug> | --artifact <id>] [--timeout 2h] [--json]
toolkit artifacts reply <thread> --body-file F [--resolve]
\`\`\`

- Hold exactly one \`toolkit artifacts wait\` at a time. It blocks until a comment arrives, prints it
  with the thread, the version it was made on and the anchor, then exits 0.
- A bare \`wait\` covers the artifacts you published from this host and worktree, so a resumed session
  in the same worktree receives feedback nobody has answered yet.
- A comment becomes deliverable ${String(limits.feedbackSettleSeconds)} seconds after Jerred writes it, so he can still edit it.
- A comment is delivered once. The next \`wait\` returns only newer comments.
- Exit codes: 0 comments, 2 usage, 4 the board or artifact is gone, 6 timeout. After a timeout,
  run \`wait\` again.
- For each comment, delegate the fix to a subagent, publish the new version, then
  \`reply <thread> --body-file F --resolve\` saying what changed. Then \`wait\` again.
- Reply without \`--resolve\` to ask a question; Jerred's answer arrives through \`wait\`.
- Do not poll, loop or run several waiters.
`;
}

function sandbox(): string {
  return `# Sandbox rules

Published pages run in a sandboxed frame on a separate origin. The frame has an opaque origin and
a strict Content-Security-Policy.

- Use relative URLs only: \`./app.js\`, \`assets/logo.png\`. An absolute path such as \`/assets/app.js\`
  fails, and so does any other origin except the allowed CDNs below.
- Use hash routing only (\`#/page\`). A \`pushState\` to another path breaks relative loads and reloads
  as a 404. Multi-page sites with relative links are fine.
- No \`localStorage\`, \`sessionStorage\`, \`indexedDB\`, cookies or service workers: they throw or do nothing.
  Keep state in memory or in the URL hash.
- \`alert\`, \`confirm\` and \`prompt\` do nothing. Do not open popups, submit forms or navigate away.
- The only network is the artifact's own files (\`fetch('./data.json')\`). No other origin, no WebSocket,
  no beacons.
- Bundle images, fonts and scripts into the artifact, or load them from the allowed CDNs: scripts,
  styles and fonts only from ${ALLOWED_CDN_ORIGINS.join(", ")}.
- Mermaid diagrams are rendered by the service from the \`.mmd\` file; publish the source.
- Markdown is shown as text and rendered by the viewer, so raw HTML in it does nothing.
`;
}

/** The guide documents, rendered from the live limits and the CSP's CDN list. */
export function renderGuide(
  limits: GuideLimits,
): Record<"SKILL" | GuideReference, string> {
  return {
    SKILL: skill(limits),
    publishing: publishing(limits),
    concepts: concepts(),
    "review-loop": reviewLoop(limits),
    sandbox: sandbox(),
  };
}

export function guideIndex(limits: GuideLimits) {
  return {
    guideVersion: GUIDE_VERSION,
    files: [
      "/agent/SKILL.md",
      ...GUIDE_REFERENCES.map((name) => `/agent/reference/${name}.md`),
    ],
    limits: {
      maxFileBytes: limits.maxFileBytes,
      maxVersionBytes: limits.maxVersionBytes,
      maxFiles: limits.maxFiles,
    },
    allowedCdns: [...ALLOWED_CDN_ORIGINS],
  };
}
