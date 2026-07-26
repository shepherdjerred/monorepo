import type {
  GenerationStateEntry,
  Person,
} from "@shepherdjerred/glitter-context/schema";
import type { CurrentMessage } from "#shared/glitter-corpus.ts";

const QUARTERLY_REFRESH_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_NEW_MESSAGES = 20;
const MIN_SAFE_MESSAGES = 20;
const MAX_STYLE_MESSAGES = 200;

export type StyleRefreshCandidate = {
  person: Person;
  messages: CurrentMessage[];
  safeMessages: CurrentMessage[];
  newMessageCount: number;
  totalMessageCount: number;
};

function isNewerSnowflake(
  messageId: string,
  previousId: string | null,
): boolean {
  return previousId === null || BigInt(messageId) > BigInt(previousId);
}

export function isSafeStyleSample(message: CurrentMessage): boolean {
  const content = message.content.trim();
  return (
    !message.author.bot &&
    message.attachments.length === 0 &&
    content.length >= 3 &&
    content.length <= 500 &&
    !content.includes("\n\n\n") &&
    !/<[@#][!&]?\d+>/u.test(content) &&
    !/@(?:everyone|here)\b/iu.test(content) &&
    !/\b(?:https?:\/\/|www\.)\S+/iu.test(content) &&
    !content.includes("@")
  );
}

export function shouldRefreshStyleCard(input: {
  newMessageCount: number;
  refreshedAt: string | null;
  now: Date;
}): boolean {
  if (input.newMessageCount >= MIN_NEW_MESSAGES) {
    return true;
  }
  if (input.refreshedAt === null) {
    return true;
  }
  return (
    input.now.getTime() - Date.parse(input.refreshedAt) >= QUARTERLY_REFRESH_MS
  );
}

export function selectStyleRefreshCandidates(input: {
  people: readonly Person[];
  state: readonly GenerationStateEntry[];
  messages: readonly CurrentMessage[];
  now: Date;
}): StyleRefreshCandidate[] {
  const stateByPerson = new Map(
    input.state.map((entry) => [entry.personId, entry]),
  );
  const messagesByAuthor = new Map<string, CurrentMessage[]>();
  for (const message of input.messages) {
    const existing = messagesByAuthor.get(message.author.id) ?? [];
    existing.push(message);
    messagesByAuthor.set(message.author.id, existing);
  }

  const candidates: StyleRefreshCandidate[] = [];
  for (const person of input.people) {
    if (person.discordUserIds.length === 0) {
      continue;
    }
    const messages = person.discordUserIds
      .flatMap((discordId) => messagesByAuthor.get(discordId) ?? [])
      .toSorted((first, second) => {
        const firstId = BigInt(first.messageId);
        const secondId = BigInt(second.messageId);
        return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
      });
    const personState = stateByPerson.get(person.id);
    const previousMessageId = personState?.lastMessageId ?? null;
    const newMessageCount = messages.filter((message) =>
      isNewerSnowflake(message.messageId, previousMessageId),
    ).length;
    const safeMessages = messages
      .filter((message) => isSafeStyleSample(message))
      .slice(-MAX_STYLE_MESSAGES);
    if (
      safeMessages.length >= MIN_SAFE_MESSAGES &&
      shouldRefreshStyleCard({
        newMessageCount,
        refreshedAt: personState?.refreshedAt ?? null,
        now: input.now,
      })
    ) {
      candidates.push({
        person,
        messages,
        safeMessages,
        newMessageCount,
        totalMessageCount: messages.length,
      });
    }
  }
  return candidates;
}
