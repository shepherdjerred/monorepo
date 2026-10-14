package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Ground;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;

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
   * @param access which kits they may pick: what they own and what is free this week
   */
  record PickKit(CombatantId id, String kitId, KitAccess access) implements MatchEvent {}

  /**
   * An operator gives a member a kit, whatever the phase until the match goes live.
   *
   * @param id who
   * @param kitId the kit
   */
  record ForceKit(CombatantId id, String kitId) implements MatchEvent {}

  /**
   * The lobby's map vote opens on these maps.
   *
   * @param candidates the maps on offer, at most {@link Ballot#SIZE}
   */
  record BallotOpened(List<Ballot.Candidate> candidates) implements MatchEvent {

    public BallotOpened {
      candidates = List.copyOf(candidates);
    }
  }

  /**
   * A member votes for a map on the ballot.
   *
   * @param id who
   * @param mapId the map
   */
  record Vote(CombatantId id, String mapId) implements MatchEvent {}

  /** An operator closes the current vote using its ordinary seeded choice. */
  record CloseVote() implements MatchEvent {}

  /**
   * An operator settles the map, overriding the vote.
   *
   * @param candidate the map
   */
  record SetMap(Ballot.Candidate candidate) implements MatchEvent {}

  /**
   * The chosen map is loaded, verified and held, ready to preview and play.
   *
   * @param map the map
   * @param now when
   */
  record MapReady(MapDefinition map, Instant now) implements MatchEvent {}

  /**
   * The chosen map could not be prepared; it leaves the ballot.
   *
   * @param mapId the map
   */
  record MapFailed(String mapId) implements MatchEvent {}

  /** An operator removed this map from the rotation and the current pregame ballot. */
  record MapQuarantined(String mapId) implements MatchEvent {}

  /**
   * Time passed. Ticks should come at least once a second; the poison runs once per second however
   * often they come.
   *
   * @param now the time
   * @param vitals position and max health of every living combatant, for the poison
   * @param motions how every living combatant moved this tick, for kit abilities
   * @param ground what the map's blocks say about a spot this tick, for kit abilities
   */
  record Tick(
      Instant now, Map<CombatantId, Vitals> vitals, Map<CombatantId, Motion> motions, Ground ground)
      implements MatchEvent {

    public Tick {
      vitals = Map.copyOf(vitals);
      motions = Map.copyOf(motions);
    }

    /** A tick with no motion reported, so no ground read. */
    public Tick(Instant now, Map<CombatantId, Vitals> vitals) {
      this(now, vitals, Map.of(), Ground.UNREAD);
    }

    public static Tick at(Instant now) {
      return new Tick(now, Map.of());
    }
  }

  /**
   * How many players are on the server, reported whenever the count changes. The Medic's small-game
   * rule reads the count the match goes live with, as Red Warfare read it when its abilities
   * registered.
   *
   * @param players players online, bots excluded
   */
  record Online(int players) implements MatchEvent {

    public Online {
      if (players < 0) {
        throw new IllegalArgumentException("players online must not be negative: " + players);
      }
    }
  }

  /**
   * An admin starts the match now.
   *
   * @param now when
   */
  record ForceStart(Instant now) implements MatchEvent {}

  /**
   * An operator moves the match on: the countdown, the preview or the freeze ends now, or the end
   * screen does.
   *
   * @param now when
   */
  record Skip(Instant now) implements MatchEvent {}

  /**
   * An operator gives the countdown, the preview or the freeze more time.
   *
   * @param by how much
   */
  record Extend(Duration by) implements MatchEvent {

    public Extend {
      if (by.isNegative() || by.isZero()) {
        throw new IllegalArgumentException("extend by a positive duration");
      }
    }
  }

  /**
   * An operator puts a member on a team for when the teams are dealt.
   *
   * @param id who
   * @param team which team
   */
  record AssignTeam(CombatantId id, TeamColor team) implements MatchEvent {}

  /** An admin or the plugin stops the match: everyone is restored and the map reset. */
  record Stop() implements MatchEvent {}

  /**
   * A living combatant lost health in a live match, from another combatant or from the world.
   *
   * @param victim who
   * @param attacker the combatant responsible, if any
   * @param damage the damage dealt
   * @param healthBefore the victim's health before it
   * @param maxHealth the victim's max health
   * @param cause how
   * @param now when
   */
  record Damaged(
      CombatantId victim,
      Optional<CombatantId> attacker,
      double damage,
      double healthBefore,
      double maxHealth,
      AttackType cause,
      Instant now)
      implements MatchEvent {}

  /**
   * A combatant died.
   *
   * @param victim who
   * @param attribution who the adapter saw kill them, how, with what and from how far; the match
   *     works out the assists from its damage log
   * @param killerHealth the killer's health at the moment, if they are alive
   * @param now when
   */
  record Died(CombatantId victim, Attribution attribution, OptionalDouble killerHealth, Instant now)
      implements MatchEvent {

    /** A death known only by its killer and cause. */
    public Died(CombatantId victim, Optional<CombatantId> killer, AttackType cause, Instant now) {
      this(victim, Attribution.of(killer, cause), OptionalDouble.empty(), now);
    }

    public Optional<CombatantId> killer() {
      return attribution.killer();
    }

    public AttackType cause() {
      return attribution.cause();
    }
  }

  /**
   * A combatant right-clicked a bomb while holding their Bomb Fuse.
   *
   * @param id who
   * @param bombId which bomb
   * @param now when
   */
  record BombClicked(CombatantId id, String bombId, Instant now) implements MatchEvent {}

  /**
   * A combatant turned their head: their whole-degree yaw or pitch changed. Clears Red Warfare's
   * AFK mark on a living combatant in a live match.
   *
   * @param id who
   */
  record LookedAround(CombatantId id) implements MatchEvent {}

  /** The adapter has finished reverting the map after a match. */
  record ResetDone() implements MatchEvent {}

  /**
   * A combatant did something their kit's ability answers.
   *
   * @param actor who
   * @param input what, with the world facts the rules need
   * @param now when
   */
  record Ability(CombatantId actor, AbilityInput input, Instant now) implements MatchEvent {}
}
