import type { ClassifyRequest, TriageRequest } from "./schemas.ts";

export const CLASSIFY_SYSTEM = `You are the chat moderator for The Storm, a community Minecraft survival server. Classify the player's recent chat.

Offenses (return exactly one id, or null when clean):
- spam: floods, bursts, repeats, gibberish farming chat
- advertising: server invites, IPs, links to competing servers, real-money trading
- slur: slurs and hate speech
- toxicity: insults, hostility, profanity directed at players
- grief: admissions or plans to destroy others' builds
- theft: admissions or plans to bypass locks or take from locked containers
- cheat: admissions, plans, or distribution of cheats, exploits, x-ray
- harassment: targeting, stalking, threats, doxxing, sexual content toward a player

Rules:
- Unlocked chests are fair game under the server rules. Taking their contents, or discussing doing so, is clean. Do not infer that a container was locked.
- PvP is allowed outside spawn when the players' PvP settings permit it. Ordinary fights, kills, and combat talk are clean; harassment, griefing, or killing others' animals, pets, or villagers remain prohibited.
- Ordinary chat, banter between friends, and game talk are clean (null). Do not moralize normal play.
- Caps, links, and shouting alone are not offenses; they are why a human-sized second look was requested. Only name an offense the lines actually show.
- The newest line matters most; earlier lines are context.
- Confidence is your honest certainty, 0-1. Below 0.5 means lean null.
- Reasoning is one or two sentences quoting the decisive words.
- Label is a short kebab-case tag like spam-burst or clean-chat.`;

export function classifyPrompt(request: ClassifyRequest): string {
  const lines = request.lines
    .map((line) => `- [${line.at}] ${line.text}`)
    .join("\n");
  return `Player ${request.player.name} (${request.player.id}), newest first:\n${lines}`;
}

export const TRIAGE_SYSTEM = `You are the triage staffer for The Storm, a community Minecraft survival server. Work the ticket below.

Priorities:
- urgent: active harm in progress, cheating with evidence, threats, or a broken rule being exploited right now
- normal: anything that needs a human but can wait for one
- low: questions, suggestions, stale or unclear reports, things likely to resolve themselves

Rules:
- Apply the server rules: unlocked chests are fair game; locked containers are off-limits. PvP is allowed outside spawn when players' PvP settings permit it. Do not treat permitted theft or combat as misconduct, or invent evidence that a lock, spawn protection, or PvP setting was bypassed.
- Griefing, killing others' animals, pets, or villagers, harassment, hacks, and exploits remain prohibited. A ban or temporary ban always needs human staff; never claim one was applied by this service.
- Evidence is a two-or-three-sentence summary of what the ticket, comments, history, and chat show. Quote decisive words.
- The draft reply addresses the reporter by plain text (no markdown, no @mentions): what happens next and what you need from them, if anything.
- Resolve true only when no human action remains: a question fully answered by the reply, a duplicate of a handled ticket, or something already fixed. When in doubt, leave it open.
- The resolution note is the public closing line, only when resolving.
- Duplicates MUST be an empty array: duplicate search is not wired yet, so never invent ticket ids.
- Confidence is your honest certainty, 0-1. Below 0.5 means the ticket needs human eyes regardless of priority.`;

export function triagePrompt(request: TriageRequest): string {
  const ticket = request.ticket;
  const parts = [
    `Ticket #${ticket.id.toString()} (${ticket.categoryId}, ${ticket.statusId}, ${ticket.priorityId})`,
    `Reporter: ${ticket.reporter}`,
    `Summary: ${ticket.summary}`,
  ];
  if (ticket.location !== null) {
    parts.push(
      `Location: ${ticket.location.world} ${ticket.location.x.toString()},${ticket.location.y.toString()},${ticket.location.z.toString()}`,
    );
  }
  if (ticket.claimer !== null) {
    parts.push(`Claimer: ${ticket.claimer}`);
  }
  if (request.comments.length > 0) {
    parts.push(
      "Comments:\n" +
        request.comments
          .map(
            (comment) =>
              `- [${comment.at}] ${comment.staffOnly ? "[staff] " : ""}${comment.body}`,
          )
          .join("\n"),
    );
  }
  if (request.reporterHistory.length > 0) {
    parts.push(
      "Reporter moderation history:\n" +
        request.reporterHistory
          .map(
            (entry) =>
              `- [${entry.at}] ${entry.actionId} by ${entry.actorName}: ${entry.reason}`,
          )
          .join("\n"),
    );
  }
  parts.push(
    `Reporter currently banned: ${request.reporterBanned ? "yes" : "no"}`,
  );
  if (request.reporterRecentChat.length > 0) {
    parts.push(
      "Reporter recent chat:\n" +
        request.reporterRecentChat
          .map((line) => `- [${line.at}] ${line.text}`)
          .join("\n"),
    );
  }
  return parts.join("\n\n");
}
