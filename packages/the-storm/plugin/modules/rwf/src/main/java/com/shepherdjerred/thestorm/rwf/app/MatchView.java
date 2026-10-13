package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The running match as a read model. The snapshot is immutable and rebuilt at most once per server
 * tick, so bots and displays may call this freely. Empty while the module has no match (before the
 * world is ready). Main thread only.
 */
public interface MatchView {

  Optional<MatchSnapshot> current();

  /** Exact temporary kit fall immunity expiry; absent when none is active. Main thread only. */
  default Optional<java.time.Instant> noFallUntil(UUID body) {
    return Optional.empty();
  }

  /** Effective authored settings, frozen before the first bot is drafted for this match. */
  default Optional<MatchExperiences.Frozen> experience(UUID matchId) {
    return Optional.empty();
  }

  /**
   * The kits a bot may be drafted onto now, by id: the four first kits, or every kit while the full
   * kit list is on for anyone here, so bots never play a kit the players cannot.
   */
  default Set<String> kitsOnOffer() {
    return MILESTONE_KITS;
  }

  /** The ids of the four first kits. */
  Set<String> MILESTONE_KITS =
      KitBook.MILESTONE_ONE.stream().map(KitSpec::id).collect(Collectors.toUnmodifiableSet());

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
