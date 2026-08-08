import { describe, expect, test } from "bun:test";

import { createFriendContextResolver } from "#src/friend-context.ts";

function createSource() {
  return {
    peopleDocument: {
      schemaVersion: 1,
      people: [
        {
          id: "alex",
          displayName: "Alex",
          kind: "person",
          aliases: ["Lex"],
          discordUserIds: ["10000000000000001"],
        },
        {
          id: "alexa",
          displayName: "Alexa",
          kind: "person",
          aliases: [],
          discordUserIds: [],
        },
        {
          id: "caitlyn",
          displayName: "Caitlyn",
          kind: "person",
          aliases: ["Cait"],
          discordUserIds: ["10000000000000002"],
        },
        {
          id: "other",
          displayName: "Other Person",
          kind: "person",
          aliases: [],
          discordUserIds: [],
        },
        {
          id: "ryan",
          displayName: "NekoRyan",
          kind: "person",
          aliases: ["Ryan"],
          discordUserIds: ["10000000000000003"],
        },
      ],
    },
    relationshipsDocument: {
      schemaVersion: 1,
      events: [
        relationship({
          id: "ryan-caitlyn-friends",
          sourceId: "ryan",
          targetId: "caitlyn",
          kind: "friendship",
          label: "Friends",
        }),
        relationship({
          id: "ryan-alex-coworkers",
          sourceId: "ryan",
          targetId: "alex",
          kind: "professional",
          label: "Coworkers",
        }),
        relationship({
          id: "alex-other-friends",
          sourceId: "alex",
          targetId: "other",
          kind: "friendship",
          label: "Friends",
        }),
        relationship({
          id: "ryan-other-history",
          sourceId: "ryan",
          targetId: "other",
          kind: "social",
          label: "Former roommates",
          status: "historical",
        }),
      ],
    },
    loreDocument: {
      schemaVersion: 1,
      historyMarkdown: `# Friend History

This preface describes the entire corpus and must not be returned.

## Timeline

### 2023
**Spring**
- NekoRyan went skating with Caitlyn at the park.

### 2024
**Spring**
- NekoRyan went skating with Caitlyn at the downtown rink.

### 2025
**January**
- Alex launched Project Comet.

**January**
- Alex celebrated Project Comet again.

**February**
- Other Person made unrelated pottery.

### 2026
**March**
- Ryan played arcade games.

**April**
- Ryan played board games.`,
    },
  };
}

function relationship(input: {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "friendship" | "professional" | "social";
  label: string;
  status?: "current" | "historical";
}) {
  return {
    id: input.id,
    sourceId: input.sourceId,
    targetId: input.targetId,
    kind: input.kind,
    label: input.label,
    direction: "undirected",
    status: input.status ?? "current",
    effectiveAt: null,
    recordedAt: "2026-01-01T00:00:00.000Z",
    supersedesEventId: null,
    provenance: [
      {
        kind: "maintainer-assertion",
        reference: "friend context test fixture",
        messageIds: [],
      },
    ],
  };
}

const resolver = createFriendContextResolver(createSource());

describe("person reference resolution", () => {
  test("resolves canonical names, aliases, prefixes, and Discord mentions", () => {
    expect(resolver.resolvePersonReference("neKORyAn")).toMatchObject({
      status: "matched",
      matchKind: "alias",
      person: { id: "ryan" },
    });
    expect(resolver.resolvePersonReference("Lex")).toMatchObject({
      status: "matched",
      matchKind: "alias",
      person: { id: "alex" },
    });
    expect(resolver.resolvePersonReference("Caitl")).toMatchObject({
      status: "matched",
      matchKind: "prefix",
      person: { id: "caitlyn" },
    });
    expect(
      resolver.resolvePersonReference("<@!10000000000000003>"),
    ).toMatchObject({
      status: "matched",
      matchKind: "discord-user-id",
      person: { id: "ryan" },
    });
  });

  test("returns deterministic candidates for ambiguity and an explicit no match", () => {
    expect(resolver.resolvePersonReference("Al")).toEqual({
      status: "ambiguous",
      reference: "Al",
      candidates: [
        expect.objectContaining({ id: "alex" }),
        expect.objectContaining({ id: "alexa" }),
      ],
    });
    expect(resolver.resolvePersonReference("Nobody")).toEqual({
      status: "unmatched",
      reference: "Nobody",
    });
  });
});

describe("just-in-time friend context", () => {
  test("finds aliases and Discord mentions in message text without duplicate people", () => {
    const context = resolver.getFriendContext({
      message: "Lex met neKORyAn and <@10000000000000003>.",
      characterBudget: 5000,
    });

    expect(context.people.map(({ person }) => person.id)).toEqual([
      "alex",
      "ryan",
    ]);
    expect(context.people[1]?.matchedReferences).toEqual([
      "<@10000000000000003>",
      "NekoRyan",
    ]);
    expect(context.resolutions).toHaveLength(1);
  });

  test("can require explicit references before resolving message aliases", () => {
    const context = resolver.getFriendContext({
      message: "How long will this take? Mark this down and google it.",
      resolveMessageAliases: false,
      characterBudget: 5000,
    });

    expect(context.people).toEqual([]);
    expect(context.relationships).toEqual([]);
    expect(context.contextText).not.toContain("Person: Long");
    expect(context.contextText).not.toContain("Person: Mark");
    expect(context.contextText).not.toContain("Person: Google");
  });

  test("ranks the strongest lexical and person match first", () => {
    const context = resolver.getFriendContext({
      message: "What happened with NekoRyan at the downtown rink?",
      characterBudget: 5000,
    });

    expect(context.loreSections[0]?.id).toBe("2024-spring");
    expect(context.loreSections[0]?.markdown).toContain("downtown rink");
    expect(context.loreSections[0]?.score).toBeGreaterThan(
      context.loreSections[1]?.score ?? 0,
    );
  });

  test("uses deterministic source ordering to break equal relevance scores", () => {
    const input = {
      message: "Ryan played games",
      characterBudget: 5000,
    };
    const first = resolver.getFriendContext(input);
    const second = resolver.getFriendContext(input);

    expect(first.loreSections.map(({ id }) => id)).toEqual(
      second.loreSections.map(({ id }) => id),
    );
    expect(first.loreSections.slice(0, 2).map(({ id }) => id)).toEqual([
      "2026-april",
      "2026-march",
    ]);
  });

  test("includes current matching relationships with direct matches first", () => {
    const context = resolver.getFriendContext({
      message: "NekoRyan and Caitlyn",
      characterBudget: 5000,
    });

    expect(context.relationships.map(({ id }) => id)).toEqual([
      "ryan-caitlyn-friends",
      "ryan-alex-coworkers",
    ]);
    expect(context.contextText).toContain(
      "Relationship: NekoRyan ↔ Caitlyn (Friends)",
    );
    expect(context.relationships).not.toContainEqual(
      expect.objectContaining({ id: "ryan-other-history" }),
    );
    expect(context.relationships).not.toContainEqual(
      expect.objectContaining({ id: "alex-other-friends" }),
    );
  });

  test("trims whole lower-ranked lore sections to the character budget", () => {
    const full = resolver.getFriendContext({
      message: "NekoRyan skating",
      characterBudget: 5000,
    });
    const firstLore = full.loreSections[0];
    if (firstLore === undefined) {
      throw new Error("expected a ranked lore section in the test fixture");
    }
    const personAndRelationships = full.contextText.split("\n\nLore:\n")[0];
    if (personAndRelationships === undefined) {
      throw new Error("expected friend context before the lore section");
    }
    const budget = `${personAndRelationships}\n\nLore:\n${firstLore.markdown}`
      .length;

    const trimmed = resolver.getFriendContext({
      message: "NekoRyan skating",
      characterBudget: budget,
    });

    expect(trimmed.characterCount).toBe(trimmed.contextText.length);
    expect(trimmed.characterCount).toBeLessThanOrEqual(budget);
    expect(trimmed.loreSections).toHaveLength(1);
    expect(trimmed.loreSections[0]?.id).toBe(firstLore.id);
    expect(trimmed.contextText).not.toContain(
      full.loreSections[1]?.markdown ?? "missing second section",
    );
    expect(trimmed.truncated).toBe(true);
  });

  test("assigns unique stable ids to repeated lore headings", () => {
    const context = resolver.getFriendContext({
      message: "Alex Project Comet",
      characterBudget: 5000,
    });
    const januaryIds = context.loreSections
      .map(({ id }) => id)
      .filter((id) => id.startsWith("2025-january"));

    expect(januaryIds).toEqual(["2025-january-2", "2025-january"]);
    expect(new Set(context.loreSections.map(({ id }) => id)).size).toBe(
      context.loreSections.length,
    );
  });

  test("returns only bounded relevant sections and never exposes the full corpus or styles", () => {
    const context = resolver.getFriendContext({
      message: "NekoRyan downtown rink",
      characterBudget: 500,
      maxLoreSections: 1,
    });

    expect(context.loreSections).toHaveLength(1);
    expect(context.contextText).toContain("downtown rink");
    expect(context.contextText).not.toContain("Project Comet");
    expect(context.contextText).not.toContain("entire corpus");
    expect(context).not.toHaveProperty("styleCards");
    expect(context.characterCount).toBeLessThanOrEqual(500);
  });

  test("rejects malformed unknown inputs at the Zod boundary", () => {
    expect(() =>
      resolver.getFriendContext({
        message: "NekoRyan",
        characterBudget: "500",
      }),
    ).toThrow();
    expect(() =>
      resolver.getFriendContext({
        message: "NekoRyan",
        characterBudget: 500,
        mentionedDiscordUserIds: ["not-a-discord-id"],
      }),
    ).toThrow();
    expect(() => resolver.resolvePersonReference({ name: "Ryan" })).toThrow();
  });
});
