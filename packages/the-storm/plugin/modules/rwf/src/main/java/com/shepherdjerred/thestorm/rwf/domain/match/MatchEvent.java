package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * Something that happened to a match. Time arrives with the event, so the rules are deterministic.
 */
public sealed interface MatchEvent {

  /**
   * A combatant asks to play.
   *
   * @param id who
   * @param name their name
   * @param now when
   */
  record Join(CombatantId id, String name, Instant now) implements MatchEvent {}

  /**
   * A combatant leaves on purpose.
   *
   * @param id who
   * @param now when
   */
  record Leave(CombatantId id, Instant now) implements MatchEvent {}

  /**
   * A combatant disconnected.
   *
   * @param id who
   * @param now when
   */
  record Disconnect(CombatantId id, Instant now) implements MatchEvent {}

  /**
   * A combatant picks a kit in the lobby.
   *
   * @param id who
   * @param kitId the kit
   */
  record PickKit(CombatantId id, String kitId) implements MatchEvent {}

  /**
   * The map vote (out of scope here) settled on a map.
   *
   * @param map the map
   */
  record MapChosen(MapDefinition map) implements MatchEvent {}

  /**
   * Time passed. Ticks should come at least once a second; the poison runs once per second however
   * often they come.
   *
   * @param now the time
   * @param vitals position and max health of every living combatant, for the poison
   */
  record Tick(Instant now, Map<CombatantId, Vitals> vitals) implements MatchEvent {

    public Tick {
      vitals = Map.copyOf(vitals);
    }

    public static Tick at(Instant now) {
      return new Tick(now, Map.of());
    }
  }

  /**
   * An admin starts the match now.
   *
   * @param now when
   */
  record ForceStart(Instant now) implements MatchEvent {}

  /** An admin or the plugin stops the match: everyone is restored and the map reset. */
  record Stop() implements MatchEvent {}

  /**
   * A combatant died.
   *
   * @param victim who
   * @param killer who killed them, if anyone
   * @param cause how
   * @param now when
   */
  record Died(CombatantId victim, Optional<CombatantId> killer, AttackType cause, Instant now)
      implements MatchEvent {}

  /**
   * A combatant right-clicked a bomb while holding their Bomb Fuse.
   *
   * @param id who
   * @param bombId which bomb
   * @param now when
   */
  record BombClicked(CombatantId id, String bombId, Instant now) implements MatchEvent {}

  /** The adapter has finished reverting the map after a match. */
  record ResetDone() implements MatchEvent {}
}
