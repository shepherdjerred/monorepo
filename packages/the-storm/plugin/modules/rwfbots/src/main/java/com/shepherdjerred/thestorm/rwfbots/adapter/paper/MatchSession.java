package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.UUID;

/**
 * One live match from the bots' side: its id mapping, its nav artifact, its seed and the capture
 * that builds its snapshots.
 *
 * @param matchId the match
 * @param seed the match seed, from which every bot's randomness derives
 * @param nav the baked map
 * @param ids the id mapping
 * @param capture the snapshot builder
 */
public record MatchSession(
    UUID matchId, long seed, NavArtifact nav, IdMap ids, SnapshotCapture capture) {

  /** A seed from the match id: the two halves folded together. */
  public static long seedOf(UUID matchId) {
    return matchId.getMostSignificantBits() ^ matchId.getLeastSignificantBits();
  }
}
