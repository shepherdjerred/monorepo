import {
  generationStateDocument,
  loreDocument,
  peopleDocument,
  relationshipsDocument,
  styleCards as validatedStyleCards,
} from "./generated-data.ts";
import { createFriendContextResolver as createResolver } from "./friend-context.ts";
import {
  StyleCardV2Schema,
  type FriendContextResult,
  type Person,
  type PersonReferenceResolution,
  type RelationshipEvent,
  type StyleCard,
  type StylePromptContext,
} from "./schema.ts";

export type FriendContextResolver = {
  resolvePersonReference: (reference: unknown) => PersonReferenceResolution;
  getFriendContext: (input: unknown) => FriendContextResult;
};

export const people = peopleDocument.people;
export const relationshipEvents = relationshipsDocument.events;
export const generationState = generationStateDocument.people;
export const friendGroupHistory = loreDocument.historyMarkdown;
export const styleCards = { ...validatedStyleCards };

export function createFriendContextResolver(
  source: unknown,
): FriendContextResolver {
  return createResolver(source);
}

const defaultFriendContextResolver = createResolver({
  peopleDocument,
  relationshipsDocument,
  loreDocument,
});

export function resolvePersonReference(
  reference: unknown,
): PersonReferenceResolution {
  return defaultFriendContextResolver.resolvePersonReference(reference);
}

export function getFriendContext(input: unknown): FriendContextResult {
  return defaultFriendContextResolver.getFriendContext(input);
}

function normalizeAlias(value: string): string {
  return value.trim().toLocaleLowerCase();
}

const peopleByAlias = new Map<string, Person>();
for (const person of people) {
  for (const alias of [person.id, person.displayName, ...person.aliases]) {
    peopleByAlias.set(normalizeAlias(alias), person);
  }
}

export function getPerson(value: string): Person | undefined {
  return peopleByAlias.get(normalizeAlias(value));
}

export function getStyleCard(
  value: string,
): (typeof styleCards)[string] | undefined {
  const person = getPerson(value);
  return person === undefined ? undefined : styleCards[person.id];
}

export function getStylePromptContext(
  value: string,
): StylePromptContext | undefined {
  const styleCard = getStyleCard(value);
  return styleCard === undefined
    ? undefined
    : styleCardToPromptContext(styleCard);
}

export function styleCardToPromptContext(
  styleCard: StyleCard,
): StylePromptContext | undefined {
  const result = StyleCardV2Schema.safeParse(styleCard);
  if (!result.success) {
    return undefined;
  }
  const {
    coverage: _coverage,
    schemaVersion: _schemaVersion,
    ...context
  } = result.data;
  return context;
}

export function listStyleCardNames(): string[] {
  return Object.keys(styleCards).sort();
}

export const currentRelationships = relationshipEvents.filter(
  (event) => event.status === "current",
);

export function getRelationshipHistory(
  firstPersonId: string,
  secondPersonId: string,
): RelationshipEvent[] {
  return relationshipEvents.filter(
    (event) =>
      (event.sourceId === firstPersonId && event.targetId === secondPersonId) ||
      (event.sourceId === secondPersonId && event.targetId === firstPersonId),
  );
}

export function relationshipContextText(): string {
  return currentRelationships
    .map((event) => {
      const source = getPerson(event.sourceId);
      const target = getPerson(event.targetId);
      if (source === undefined || target === undefined) {
        throw new Error(
          `relationship ${event.id} references an unknown person`,
        );
      }
      const direction = event.direction === "undirected" ? " ↔ " : " → ";
      const label = event.label.length === 0 ? "" : ` (${event.label})`;
      return `${source.displayName}${direction}${target.displayName}${label}`;
    })
    .join("\n");
}
