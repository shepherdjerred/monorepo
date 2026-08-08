import { z } from "zod";

import {
  parseLoreSections,
  type ParsedLoreSection,
} from "./friend-context-lore.ts";
import {
  FriendContextInputSchema,
  FriendContextResultSchema,
  FriendContextSourceSchema,
  PersonReferenceResolutionSchema,
  type FriendContextLoreSection,
  type FriendContextResult,
  type Person,
  type PersonReferenceResolution,
  type RelationshipEvent,
  type ResolvedFriendContextPerson,
} from "./schema.ts";

type RankedLoreSection = FriendContextLoreSection & {
  matchedPersonCount: number;
  sourceOrder: number;
};

type AliasMatcher = {
  alias: string;
  person: Person;
  matches: (text: string) => boolean;
};

type ContextCandidate =
  | { kind: "person"; id: string; text: string }
  | { kind: "relationship"; id: string; text: string }
  | { kind: "lore"; id: string; text: string };

export type FriendContextResolver = {
  resolvePersonReference: (reference: unknown) => PersonReferenceResolution;
  getFriendContext: (input: unknown) => FriendContextResult;
};

const ReferenceSchema = z.string().trim().min(1);
const DiscordMentionSchema = z
  .string()
  .regex(/^<@!?\d{17,20}>$/u, "expected a Discord user mention");

const STOP_WORDS = new Set([
  "about",
  "and",
  "are",
  "did",
  "for",
  "from",
  "have",
  "how",
  "into",
  "our",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "you",
]);

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalize(text);
  const normalizedPhrase = normalize(phrase);
  let index = normalizedText.indexOf(normalizedPhrase);
  while (index !== -1) {
    const before = normalizedText.slice(0, index);
    const after = normalizedText.slice(index + normalizedPhrase.length);
    if (!/[\p{L}\p{N}]$/u.test(before) && !/^[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    index = normalizedText.indexOf(
      normalizedPhrase,
      index + normalizedPhrase.length,
    );
  }
  return false;
}

function tokenize(value: string): string[] {
  return (normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length >= 2 && !STOP_WORDS.has(token),
  );
}

function discordUserId(reference: string): string | undefined {
  if (/^\d{17,20}$/u.test(reference)) {
    return reference;
  }
  if (!DiscordMentionSchema.safeParse(reference).success) {
    return undefined;
  }
  const matchedUserId = /^<@!?(\d{17,20})>$/u.exec(reference)?.[1];
  if (matchedUserId === undefined) {
    throw new Error("validated Discord mention did not contain a user id");
  }
  return matchedUserId;
}

function formatRelationship(
  event: RelationshipEvent,
  peopleById: ReadonlyMap<string, Person>,
): string {
  const source = peopleById.get(event.sourceId);
  const target = peopleById.get(event.targetId);
  if (source === undefined || target === undefined) {
    throw new Error(`relationship ${event.id} references an unknown person`);
  }
  const direction = event.direction === "undirected" ? " ↔ " : " → ";
  const label = event.label.length === 0 ? "" : ` (${event.label})`;
  return `Relationship: ${source.displayName}${direction}${target.displayName}${label}`;
}

function rankLoreSections(
  sections: readonly ParsedLoreSection[],
  options: {
    message: string;
    references: readonly string[];
    resolvedPeople: readonly ResolvedFriendContextPerson[];
    ignoredPersonTerms: readonly string[];
  },
): RankedLoreSection[] {
  const peopleTerms = options.resolvedPeople.map(({ person }) => ({
    personId: person.id,
    terms: [person.id, person.displayName, ...person.aliases],
  }));
  const allPersonTerms = [
    ...peopleTerms,
    ...options.ignoredPersonTerms.map((term) => ({
      personId: term,
      terms: [term],
    })),
  ];
  const personTokens = new Set(
    allPersonTerms.flatMap(({ terms }) =>
      terms.flatMap((term) => tokenize(term)),
    ),
  );
  const queryTokens = new Set(
    tokenize(`${options.message}\n${options.references.join("\n")}`).filter(
      (token) => !personTokens.has(token),
    ),
  );

  return sections
    .map((section): RankedLoreSection | undefined => {
      const matchedTerms = new Set<string>();
      const matchedPersonIds = new Set<string>();

      for (const { personId, terms } of peopleTerms) {
        for (const term of terms) {
          if (containsPhrase(section.searchableText, term)) {
            matchedPersonIds.add(personId);
            matchedTerms.add(normalize(term));
          }
        }
      }

      const sectionTokens = new Set(tokenize(section.searchableText));
      let lexicalMatches = 0;
      for (const token of queryTokens) {
        if (sectionTokens.has(token)) {
          lexicalMatches += 1;
          matchedTerms.add(token);
        }
      }

      const score = matchedPersonIds.size * 100 + lexicalMatches * 100;
      if (score === 0) {
        return undefined;
      }
      return {
        id: section.id,
        title: section.title,
        markdown: section.markdown,
        score,
        matchedTerms: [...matchedTerms].sort(),
        matchedPersonCount: matchedPersonIds.size,
        sourceOrder: section.sourceOrder,
      };
    })
    .filter((section) => section !== undefined)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.matchedPersonCount - left.matchedPersonCount ||
        right.sourceOrder - left.sourceOrder ||
        left.id.localeCompare(right.id),
    );
}

export function createFriendContextResolver(
  rawSource: unknown,
): FriendContextResolver {
  const source = FriendContextSourceSchema.parse(rawSource);
  const peopleById = new Map(
    source.peopleDocument.people.map((person) => [person.id, person]),
  );
  const peopleByAlias = new Map<string, Person>();
  const peopleByDiscordUserId = new Map<string, Person>();
  const aliasMatchers: AliasMatcher[] = [];

  for (const person of source.peopleDocument.people) {
    for (const alias of [person.id, person.displayName, ...person.aliases]) {
      const normalizedAlias = normalize(alias);
      peopleByAlias.set(normalizedAlias, person);
      aliasMatchers.push({
        alias,
        person,
        matches: (text) => containsPhrase(text, alias),
      });
    }
    for (const userId of person.discordUserIds) {
      peopleByDiscordUserId.set(userId, person);
    }
  }
  aliasMatchers.sort(
    (left, right) =>
      right.alias.length - left.alias.length ||
      normalize(left.alias).localeCompare(normalize(right.alias)) ||
      left.person.id.localeCompare(right.person.id),
  );

  for (const event of source.relationshipsDocument.events) {
    if (!peopleById.has(event.sourceId) || !peopleById.has(event.targetId)) {
      throw new Error(`relationship ${event.id} references an unknown person`);
    }
  }

  const loreSections = parseLoreSections(source.loreDocument.historyMarkdown);

  function resolvePersonReference(
    rawReference: unknown,
  ): PersonReferenceResolution {
    const reference = ReferenceSchema.parse(rawReference);
    const userId = discordUserId(reference);
    if (userId !== undefined) {
      const person = peopleByDiscordUserId.get(userId);
      return PersonReferenceResolutionSchema.parse(
        person === undefined
          ? { status: "unmatched", reference }
          : {
              status: "matched",
              reference,
              matchKind: "discord-user-id",
              person,
            },
      );
    }

    const normalizedReference = normalize(reference);
    const exactPerson = peopleByAlias.get(normalizedReference);
    if (exactPerson !== undefined) {
      return PersonReferenceResolutionSchema.parse({
        status: "matched",
        reference,
        matchKind: "alias",
        person: exactPerson,
      });
    }

    const candidatesById = new Map<string, Person>();
    for (const [alias, person] of peopleByAlias) {
      if (alias.startsWith(normalizedReference)) {
        candidatesById.set(person.id, person);
      }
    }
    const candidates = [...candidatesById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (candidates.length === 1) {
      return PersonReferenceResolutionSchema.parse({
        status: "matched",
        reference,
        matchKind: "prefix",
        person: candidates[0],
      });
    }
    if (candidates.length > 1) {
      return PersonReferenceResolutionSchema.parse({
        status: "ambiguous",
        reference,
        candidates,
      });
    }
    return PersonReferenceResolutionSchema.parse({
      status: "unmatched",
      reference,
    });
  }

  function getFriendContext(rawInput: unknown): FriendContextResult {
    const input = FriendContextInputSchema.parse(rawInput);
    const resolutions: PersonReferenceResolution[] = [];
    const resolvedById = new Map<
      string,
      { person: Person; matchedReferences: Set<string> }
    >();
    const resolvedReferenceKeys = new Set<string>();

    function addResolvedPerson(person: Person, reference: string): void {
      const existing = resolvedById.get(person.id);
      if (existing === undefined) {
        resolvedById.set(person.id, {
          person,
          matchedReferences: new Set([reference]),
        });
        return;
      }
      existing.matchedReferences.add(reference);
    }

    function addResolution(reference: string): void {
      const resolutionKey = normalize(reference);
      if (resolvedReferenceKeys.has(resolutionKey)) {
        return;
      }
      resolvedReferenceKeys.add(resolutionKey);
      const resolution = resolvePersonReference(reference);
      resolutions.push(resolution);
      if (resolution.status === "matched") {
        addResolvedPerson(resolution.person, resolution.reference);
      }
    }

    for (const reference of input.references) {
      addResolution(reference);
    }
    for (const userId of input.mentionedDiscordUserIds) {
      addResolution(userId);
    }
    for (const mentionMatch of input.message.matchAll(/<@!?(\d{17,20})>/gu)) {
      const mention = mentionMatch[0];
      addResolution(mention);
    }
    if (input.resolveMessageAliases) {
      for (const matcher of aliasMatchers) {
        if (matcher.matches(input.message)) {
          addResolvedPerson(matcher.person, matcher.alias);
        }
      }
    }

    const resolvedPeople: ResolvedFriendContextPerson[] = [
      ...resolvedById.values(),
    ]
      .map(({ person, matchedReferences }) => ({
        person,
        matchedReferences: [...matchedReferences].sort((left, right) =>
          normalize(left).localeCompare(normalize(right)),
        ),
      }))
      .sort((left, right) => left.person.id.localeCompare(right.person.id));
    const resolvedPersonIds = new Set(
      resolvedPeople.map(({ person }) => person.id),
    );

    const matchingRelationships = source.relationshipsDocument.events
      .filter(
        (event) =>
          event.status === "current" &&
          (resolvedPersonIds.has(event.sourceId) ||
            resolvedPersonIds.has(event.targetId)),
      )
      .sort((left, right) => {
        const leftMatches =
          Number(resolvedPersonIds.has(left.sourceId)) +
          Number(resolvedPersonIds.has(left.targetId));
        const rightMatches =
          Number(resolvedPersonIds.has(right.sourceId)) +
          Number(resolvedPersonIds.has(right.targetId));
        return rightMatches - leftMatches || left.id.localeCompare(right.id);
      });

    const rankedLoreSections = rankLoreSections(loreSections, {
      message: input.message,
      references: input.references,
      resolvedPeople,
      ignoredPersonTerms: input.resolveMessageAliases
        ? []
        : aliasMatchers.map(({ alias }) => alias),
    });
    const eligibleLoreSections = rankedLoreSections.slice(
      0,
      input.maxLoreSections,
    );
    let truncated = rankedLoreSections.length > eligibleLoreSections.length;

    const candidates: ContextCandidate[] = [
      ...resolvedPeople.map(({ person }) => ({
        kind: "person" as const,
        id: person.id,
        text: `Person: ${person.displayName} [${person.id}]`,
      })),
      ...matchingRelationships.map((event) => ({
        kind: "relationship" as const,
        id: event.id,
        text: formatRelationship(event, peopleById),
      })),
      ...eligibleLoreSections.map((section) => ({
        kind: "lore" as const,
        id: section.id,
        text: `Lore:\n${section.markdown}`,
      })),
    ];
    const includedCandidates: ContextCandidate[] = [];
    let characterCount = 0;
    for (const candidate of candidates) {
      const separatorLength = includedCandidates.length === 0 ? 0 : 2;
      const nextCharacterCount =
        characterCount + separatorLength + candidate.text.length;
      if (nextCharacterCount <= input.characterBudget) {
        includedCandidates.push(candidate);
        characterCount = nextCharacterCount;
      } else {
        truncated = true;
      }
    }

    const includedRelationshipIds = new Set(
      includedCandidates
        .filter((candidate) => candidate.kind === "relationship")
        .map((candidate) => candidate.id),
    );
    const includedLoreIds = new Set(
      includedCandidates
        .filter((candidate) => candidate.kind === "lore")
        .map((candidate) => candidate.id),
    );
    const relationships = matchingRelationships.filter((event) =>
      includedRelationshipIds.has(event.id),
    );
    const selectedLoreSections = eligibleLoreSections
      .filter((section) => includedLoreIds.has(section.id))
      .map(
        ({
          matchedPersonCount: _matchedPersonCount,
          sourceOrder: _sourceOrder,
          ...section
        }) => section,
      );
    const contextText = includedCandidates
      .map((candidate) => candidate.text)
      .join("\n\n");

    return FriendContextResultSchema.parse({
      resolutions,
      people: resolvedPeople,
      relationships,
      loreSections: selectedLoreSections,
      contextText,
      characterCount,
      truncated,
    });
  }

  return { resolvePersonReference, getFriendContext };
}
