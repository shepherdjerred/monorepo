import { prisma } from "#src/database/index.ts";

/**
 * What this snapshot contains, as an identity that survives being restored.
 *
 * A replay writes: drafting a dare or preparing a creation persists rows, and
 * nothing rolls them back. The coherence check therefore demands the snapshot
 * be restored between sweeps — and `dev:db-pull` restores by dropping and
 * recreating the database, which assigns a fresh OID every time. An
 * instance-level identity would make a baseline and its candidate look like
 * different datasets after exactly the restore the harness asked for, and the
 * A/B it exists to support could never run twice.
 *
 * So this counts content that a replay never writes — accounts, conversations
 * and their messages, which the runner deliberately leaves alone by calling
 * `streamExploreAgent` rather than the persisted turn above it. Restoring the
 * same dump reproduces these counts exactly; a later pull does not.
 */
export async function databaseSnapshotId(): Promise<string> {
  const [accounts, conversations, messages, players] = await Promise.all([
    prisma.account.count(),
    prisma.exploreConversation.count(),
    prisma.exploreMessage.count(),
    prisma.player.count(),
  ]);
  return [accounts, conversations, messages, players]
    .map((count) => count.toString())
    .join("-");
}
