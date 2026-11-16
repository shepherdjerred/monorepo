import { describe, expect, it } from "vitest";
import { Attachments } from "#infrastructure/attachments.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { Forum } from "#infrastructure/forum.ts";
import { appRouter } from "#server/router.ts";
import { ActorSchema } from "#shared/actor.ts";
import { CreateForumPostSchema } from "#shared/forum.ts";
import { IdentifierSchema, TeamKeySchema } from "#shared/schema.ts";
import { memoryObjectStore } from "./memory-object-store.ts";
import { useTrackerSuite } from "./suite.ts";

const suite = useTrackerSuite("forum-v2");
const peer = ActorSchema.parse({
  key: "claude-code:forum-v2-peer",
  kind: "agent",
  name: "Claude Peer",
  metadata: { sessionId: "forum-v2-peer" },
});
const human = ActorSchema.parse({
  key: "human:jerred",
  kind: "human",
  name: "Jerred",
});

function createCaller() {
  const store = memoryObjectStore();
  const attachments = new Attachments(suite.database, suite.unit, store);
  const forum = new Forum(suite.database, suite.unit);
  const caller = appRouter.createCaller({
    forum,
    forumEnabled: async () => true,
    issues: suite.issues,
    catalog: suite.catalog,
    collaboration: new Collaboration(suite.database, suite.unit),
    attachments,
    requestId: crypto.randomUUID(),
    writesEnabled: async () => true,
    liveUpdatesEnabled: async () => false,
  });
  return { caller, forum, attachments };
}

describe("Forum v2 identifiers, kinds, and FM reservation", () => {
  it("assigns sequential FM-<N> identifiers, resolves case-insensitively, and reserves FM", async () => {
    expect(TeamKeySchema.safeParse("FM").success).toBe(false);
    expect(IdentifierSchema.safeParse("FM-1").success).toBe(false);
    expect(IdentifierSchema.safeParse("FMT-1").success).toBe(true);
    await expect(
      suite.database.team.create({ data: { key: "FM", name: "Forbidden" } }),
    ).rejects.toThrow();

    const { caller } = createCaller();
    const first = await caller.forum.create({
      actor: suite.actor,
      kind: "discussion",
      title: "Architecture thread",
      body: "First discussion body",
    });
    const second = await caller.forum.create({
      actor: suite.actor,
      kind: "decision",
      title: "ADR: Adopt Forum v2",
      body: "We decided to unify coordination and Q&A.",
    });
    expect(first.identifier).toBe(`FM-${String(first.number)}`);
    expect(second.number).toBe(first.number + 1);

    const byLower = await caller.forum.byId({
      id: first.identifier.toLowerCase(),
    });
    expect(byLower.id).toBe(first.id);

    const updated = await caller.forum.update({
      actor: peer,
      id: first.identifier.toLowerCase(),
      expectedRevision: first.revision,
      title: "Updated via lowercase FM reference",
    });
    expect(updated.title).toBe("Updated via lowercase FM reference");
    expect(updated.editedAt).not.toBeNull();
  });

  it("supports all 4 forum kinds and rejects notice-only fields on non-notices", async () => {
    for (const kind of ["discussion", "question", "decision"] as const) {
      expect(
        CreateForumPostSchema.safeParse({
          actor: suite.actor,
          kind,
          title: "Invalid",
          body: "Body",
          exitCondition: "Nope",
        }).success,
      ).toBe(false);
      expect(
        CreateForumPostSchema.safeParse({
          actor: suite.actor,
          kind,
          title: "Invalid owner",
          body: "Body",
          ownerKey: peer.key,
        }).success,
      ).toBe(false);
    }
    const { caller } = createCaller();
    const question = await caller.forum.create({
      actor: suite.actor,
      kind: "question",
      title: "How should workers retry?",
      body: "Details on backoff.",
    });
    expect(question).toMatchObject({ kind: "question", answered: false });
  });
});

describe("Forum v2 two-level threading, editing, and tombstones", () => {
  it("enforces 2-level nesting, edits replies, hard-deletes leaves, and tombstones parents", async () => {
    const { caller } = createCaller();
    const post = await caller.forum.create({
      actor: suite.actor,
      kind: "discussion",
      title: "Threading checks",
      body: "Top-level thread",
    });
    const rootReply = await caller.forum.reply({
      actor: suite.actor,
      id: post.identifier,
      body: "Root reply",
    });
    const childReply = await caller.forum.reply({
      actor: peer,
      id: post.identifier,
      parentReplyId: rootReply.id,
      body: "Nested child reply",
    });
    const leafReply = await caller.forum.reply({
      actor: human,
      id: post.identifier,
      body: "Standalone leaf reply",
    });
    await expect(
      caller.forum.reply({
        actor: suite.actor,
        id: post.identifier,
        parentReplyId: childReply.id,
        body: "Depth 3 must fail",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const editedChild = await caller.forum.updateReply({
      actor: peer,
      replyId: childReply.id,
      body: "Edited nested child reply",
    });
    expect(editedChild.editedAt).not.toBeNull();

    const deletedLeaf = await caller.forum.deleteReply({
      actor: human,
      replyId: leafReply.id,
    });
    expect(deletedLeaf.tombstoned).toBe(false);

    const deletedRoot = await caller.forum.deleteReply({
      actor: suite.actor,
      replyId: rootReply.id,
    });
    expect(deletedRoot.tombstoned).toBe(true);

    const detail = await caller.forum.byId({ id: post.identifier });
    expect(detail.replyCount).toBe(1);
    expect(detail.replies).toHaveLength(2);
    expect(
      detail.replies.find((item) => item.id === rootReply.id),
    ).toMatchObject({ deleted: true, body: "" });
    expect(
      detail.replies.find((item) => item.id === childReply.id),
    ).toMatchObject({
      deleted: false,
      body: "Edited nested child reply",
      parentReplyId: rootReply.id,
    });
  });
});

describe("Forum v2 Q&A accepted answers and notice coordination", () => {
  it("accepts and unaccepts answers on questions while rejecting non-questions", async () => {
    const { caller } = createCaller();
    const question = await caller.forum.create({
      actor: suite.actor,
      kind: "question",
      title: "Which queue handles nightly syncs?",
      body: "Checking task queue routing.",
    });
    const answer = await caller.forum.reply({
      actor: peer,
      id: question.identifier,
      body: "Use the temporal maintenance queue.",
    });
    const unansweredList = await caller.forum.list({ state: "unanswered" });
    expect(unansweredList.items.some((item) => item.id === question.id)).toBe(
      true,
    );

    const accepted = await caller.forum.acceptReply({
      actor: suite.actor,
      id: question.identifier,
      replyId: answer.id,
    });
    expect(accepted).toMatchObject({
      answered: true,
      acceptedReplyId: answer.id,
    });
    const answeredList = await caller.forum.list({ state: "answered" });
    expect(answeredList.items.some((item) => item.id === question.id)).toBe(
      true,
    );
    const questionDetail = await caller.forum.byId({ id: question.identifier });
    expect(questionDetail.replies[0]?.accepted).toBe(true);

    const unaccepted = await caller.forum.acceptReply({
      actor: suite.actor,
      id: question.identifier,
      replyId: null,
    });
    expect(unaccepted.answered).toBe(false);

    const discussion = await caller.forum.create({
      actor: suite.actor,
      kind: "discussion",
      title: "General chat",
      body: "Not a Q&A",
    });
    const discReply = await caller.forum.reply({
      actor: peer,
      id: discussion.identifier,
      body: "Hello",
    });
    await expect(
      caller.forum.acceptReply({
        actor: suite.actor,
        id: discussion.identifier,
        replyId: discReply.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("claims and hands off notices with optional reply notes and ownerKey filters", async () => {
    const { caller } = createCaller();
    const notice = await caller.forum.create({
      actor: suite.actor,
      kind: "notice",
      title: "ArgoCD sync hold",
      body: "Holding root sync during migration",
      exitCondition: "Migration verified",
      scopes: ["argocd", "cluster"],
    });
    const unclaimedList = await caller.forum.list({ ownerKey: null });
    expect(unclaimedList.items.some((item) => item.id === notice.id)).toBe(
      true,
    );

    const claimed = await caller.forum.claim({
      actor: peer,
      id: notice.identifier,
      note: "Taking ownership of cluster verification.",
    });
    expect(claimed.owner?.key).toBe(peer.key);
    expect(claimed.replyCount).toBe(1);
    const peerOwnedList = await caller.forum.list({ ownerKey: peer.key });
    expect(peerOwnedList.items.some((item) => item.id === notice.id)).toBe(
      true,
    );

    const handedOff = await caller.forum.handoff({
      actor: peer,
      id: notice.identifier,
      toActorKey: suite.actor.key,
      note: "Handing back for final sign-off.",
    });
    expect(handedOff.owner?.key).toBe(suite.actor.key);
    expect(handedOff.replyCount).toBe(2);

    const cleared = await caller.forum.handoff({
      actor: suite.actor,
      id: notice.identifier,
      toActorKey: null,
    });
    expect(cleared.owner).toBeNull();
  });
});

describe("Forum v2 votes, reactions, pins, projects, attachments, inbox & search", () => {
  it("tracks post & reply votes, emoji reactions, pins, projects, and attachments", async () => {
    const { caller, attachments } = createCaller();
    await suite.catalog.project(
      {
        actor: suite.actor,
        slug: "forum-upgrade",
        name: "Forum Upgrade",
        color: "#22c55e",
      },
      true,
      crypto.randomUUID(),
    );
    const postUpload = await attachments.upload(
      new File(["post-diagram"], "diagram.txt", { type: "text/plain" }),
      suite.actor,
      1024 * 1024,
      crypto.randomUUID(),
    );
    const replyUpload = await attachments.upload(
      new File(["reply-log"], "trace.log", { type: "text/plain" }),
      peer,
      1024 * 1024,
      crypto.randomUUID(),
    );
    const unpinned = await caller.forum.create({
      actor: suite.actor,
      kind: "discussion",
      title: "Unpinned newer post",
      body: "Regular discussion",
    });
    const pinnedPost = await caller.forum.create({
      actor: suite.actor,
      kind: "decision",
      title: "Pinned project decision",
      body: "See attached diagram",
      projectSlug: "forum-upgrade",
      attachmentIds: [postUpload.id],
    });
    await caller.forum.pin({
      actor: human,
      id: pinnedPost.identifier,
      pinned: true,
    });

    const feed = await caller.forum.list({});
    expect(feed.items.findIndex((i) => i.id === pinnedPost.id)).toBeLessThan(
      feed.items.findIndex((i) => i.id === unpinned.id),
    );
    const projectFeed = await caller.forum.list({
      projectSlug: "forum-upgrade",
    });
    expect(projectFeed.items.map((i) => i.id)).toEqual([pinnedPost.id]);

    const reply = await caller.forum.reply({
      actor: peer,
      id: pinnedPost.identifier,
      body: "Attached trace log",
      attachmentIds: [replyUpload.id],
    });
    await caller.forum.vote({
      actor: peer,
      id: pinnedPost.identifier,
      note: "High leverage architectural decision",
    });
    await caller.forum.vote({ actor: human, replyId: reply.id });
    await caller.forum.react({
      actor: peer,
      id: pinnedPost.identifier,
      emoji: "🚀",
    });
    await caller.forum.react({
      actor: human,
      id: pinnedPost.identifier,
      emoji: "🚀",
    });
    await caller.forum.react({
      actor: suite.actor,
      replyId: reply.id,
      emoji: "✅",
    });

    const detail = await caller.forum.byId({
      id: pinnedPost.identifier,
      viewerActorKey: peer.key,
    });
    expect(detail).toMatchObject({ voteCount: 1, viewerVoted: true });
    expect(detail.votes[0]?.note).toBe("High leverage architectural decision");
    expect(detail.reactions).toEqual([
      {
        emoji: "🚀",
        count: 2,
        actorKeys: [peer.key, human.key],
        viewerReacted: true,
      },
    ]);
    expect(detail.attachments[0]?.url).toContain("diagram.txt");
    expect(detail.replies[0]?.voteCount).toBe(1);
    expect(detail.replies[0]?.reactions[0]).toMatchObject({
      emoji: "✅",
      count: 1,
    });
    expect(detail.replies[0]?.attachments[0]?.url).toContain("trace.log");
  });

  it("manages subscriptions, unread state, inbox, scopes, and full-text/trigram/FM search", async () => {
    const { caller } = createCaller();
    const post = await caller.forum.create({
      actor: suite.actor,
      kind: "discussion",
      title: "Observability Cardinality Budget",
      body: "Prometheus label cardinality spike investigation.",
      scopes: ["observability", "metrics"],
    });
    expect(
      await caller.forum.byId({
        id: post.identifier,
        viewerActorKey: suite.actor.key,
      }),
    ).toMatchObject({ unread: false, viewerSubscription: "subscribed" });
    const peerInitialView = await caller.forum.byId({
      id: post.identifier,
      viewerActorKey: peer.key,
    });
    expect(peerInitialView.unread).toBe(true);

    await caller.forum.subscribe({
      actor: peer,
      id: post.identifier,
      mode: "subscribed",
    });
    await caller.forum.markRead({ actor: peer, id: post.identifier });
    const peerUnreadInbox = await caller.forum.inbox({
      viewerActorKey: peer.key,
      unreadOnly: true,
    });
    expect(peerUnreadInbox.items).not.toContainEqual(
      expect.objectContaining({ id: post.id }),
    );

    await caller.forum.reply({
      actor: human,
      id: post.identifier,
      body: "Found high-cardinality pod_uid histogram bucket.",
    });
    const creatorUnreadInbox = await caller.forum.inbox({
      viewerActorKey: suite.actor.key,
      unreadOnly: true,
    });
    expect(creatorUnreadInbox.items.some((item) => item.id === post.id)).toBe(
      true,
    );

    await caller.forum.subscribe({
      actor: peer,
      id: post.identifier,
      mode: "muted",
    });
    const peerMutedInbox = await caller.forum.inbox({
      viewerActorKey: peer.key,
      unreadOnly: false,
    });
    expect(peerMutedInbox.items.some((item) => item.id === post.id)).toBe(
      false,
    );

    const scopes = await caller.forum.scopes();
    expect(
      scopes.some((s) => s.scope === "observability" && s.openCount >= 1),
    ).toBe(true);

    const fts = await caller.forum.search({ query: "histogram bucket" });
    expect(fts.items.find((i) => i.id === post.id)?.searchSnippet).toContain(
      "histogram",
    );
    const trigram = await caller.forum.search({
      query: "Observablity Cardnality",
    });
    expect(trigram.items.some((item) => item.id === post.id)).toBe(true);
    const exactIdSearch = await caller.forum.search({ query: post.identifier });
    expect(exactIdSearch.items[0]?.id).toBe(post.id);
  });
});

describe("Forum v2 bidirectional issue links and atomic promotion", () => {
  it("links/unlinks issues, promotes threads & replies into AI issues, and exposes forumThreads", async () => {
    const { caller } = createCaller();
    const existingIssue = await suite.create("Existing tracker issue");
    const post = await caller.forum.create({
      actor: suite.actor,
      kind: "question",
      title: "Should we batch live-update notifications?",
      body: "Burst writes emit multiple pg_notify payloads.",
      linkedIssueIdentifiers: [existingIssue.identifier],
    });
    const existingDetail = await caller.issues.byIdentifier({
      identifier: existingIssue.identifier,
    });
    expect(existingDetail.forumThreads).toEqual([
      expect.objectContaining({ id: post.id, identifier: post.identifier }),
    ]);

    const reply = await caller.forum.reply({
      actor: peer,
      id: post.identifier,
      body: "Let's coalesce notifications per transaction.",
    });
    const promoted = await caller.forum.promoteToIssue({
      actor: peer,
      id: post.identifier,
      replyId: reply.id,
      priority: 2,
    });
    expect(promoted.issue.identifier).toMatch(/^AI-\d+$/u);
    expect(promoted.issue.description).toContain(post.identifier);
    expect(promoted.issue.description).toContain(
      "coalesce notifications per transaction",
    );
    const linkedList = await caller.forum.list({
      linkedIssueIdentifier: promoted.issue.identifier,
    });
    expect(linkedList.items.map((i) => i.id)).toEqual([post.id]);
    const promotedDetail = await caller.issues.byIdentifier({
      identifier: promoted.issue.identifier,
    });
    expect(promotedDetail.forumThreads).toEqual([
      expect.objectContaining({
        id: post.id,
        identifier: post.identifier,
        sourceReplyId: reply.id,
      }),
    ]);

    const afterUnlink = await caller.forum.unlinkIssue({
      actor: suite.actor,
      id: post.identifier,
      issueIdentifier: existingIssue.identifier,
    });
    expect(afterUnlink.linkedIssues.map((i) => i.identifier)).toEqual([
      promoted.issue.identifier,
    ]);
  });
});
