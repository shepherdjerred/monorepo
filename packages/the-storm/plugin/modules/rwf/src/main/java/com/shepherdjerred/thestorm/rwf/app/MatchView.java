package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.Optional;
import java.util.UUID;

/**
 * The running match as a read model. The snapshot is immutable and rebuilt at most once per server
 * tick, so bots and displays may call this freely. Empty while the module has no match (before the
 * world is ready). Main thread only.
 */
public interface MatchView {

  Optional<MatchSnapshot> current();

  /**
   * Whether a body is still fighting now. Query immediately before driving it: another body's
   * command may have killed or removed it since the tick's world snapshot was captured.
   */
  default boolean isFighting(UUID matchId, UUID body) {
    return current()
        .filter(snapshot -> snapshot.matchId().equals(matchId))
        .filter(snapshot -> snapshot.phase() == MatchSnapshot.PhaseKind.LIVE)
        .stream()
        .flatMap(snapshot -> snapshot.combatants().stream())
        .anyMatch(fighter -> fighter.id().uuid().equals(body) && fighter.alive());
  }
}
