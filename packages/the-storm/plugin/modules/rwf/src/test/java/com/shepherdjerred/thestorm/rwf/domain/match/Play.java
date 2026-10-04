package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Drives an {@link RwfMatch} through events in tests, keeping the latest state. */
final class Play {

  /** Settings that start a match with two players and pay rewards after a minute. */
  static final MatchSettings SETTINGS =
      new MatchSettings(
          2,
          2,
          60,
          Duration.ofSeconds(90),
          Duration.ofSeconds(15),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1));

  RwfMatch match;
  Instant now;

  Play(MatchSettings settings, Instant start) {
    this.match = RwfMatch.open(settings, Samples.MATCH, Samples.SEED);
    this.now = start;
  }

  Play() {
    this(SETTINGS, Samples.T0);
  }

  /** Applies {@code event}, which must be accepted, and returns its effects. */
  List<MatchEffect> ok(MatchEvent event) {
    return switch (match.on(event)) {
      case Result.Ok<RwfMatch.Step, MatchError>(var step) -> {
        match = step.match();
        yield step.effects();
      }
      case Result.Err<RwfMatch.Step, MatchError>(var error) ->
          throw new AssertionError(event + " was refused: " + error);
    };
  }

  /** Applies {@code event}, which must be refused, and returns why. The state is unchanged. */
  MatchError refused(MatchEvent event) {
    return switch (match.on(event)) {
      case Result.Ok<RwfMatch.Step, MatchError>(var step) ->
          throw new AssertionError(event + " was accepted: " + step.effects());
      case Result.Err<RwfMatch.Step, MatchError>(var error) -> error;
    };
  }

  /** A tick {@code seconds} later, with vitals for every living combatant at their spawn. */
  List<MatchEffect> tick(long seconds) {
    now = now.plus(Duration.ofSeconds(seconds));
    return ok(new MatchEvent.Tick(now, vitals()));
  }

  /** A tick {@code millis} later. */
  List<MatchEffect> tickMillis(long millis) {
    now = now.plusMillis(millis);
    return ok(new MatchEvent.Tick(now, vitals()));
  }

  /** Every living combatant standing on their team's first spawn with 20 health. */
  Map<CombatantId, Vitals> vitals() {
    var vitals = new HashMap<CombatantId, Vitals>();
    for (var member : match.members()) {
      if (member.alive()) {
        vitals.put(member.id(), new Vitals(spawnOf(member), 20));
      }
    }
    return vitals;
  }

  private Vec3 spawnOf(Combatant member) {
    var map = match.map().orElseThrow();
    return member
        .team()
        .flatMap(map::team)
        .map(team -> team.spawns().getFirst().position())
        .orElseThrow();
  }

  List<MatchEffect> join(CombatantId id) {
    return ok(new MatchEvent.Join(id, name(id), now));
  }

  /** Joins everyone, chooses {@code map} and force-starts. */
  List<MatchEffect> start(MapDefinition map, CombatantId... players) {
    for (var player : players) {
      join(player);
    }
    ok(new MatchEvent.MapChosen(map));
    return ok(new MatchEvent.ForceStart(now));
  }

  List<MatchEffect> died(CombatantId victim, Optional<CombatantId> killer) {
    return ok(new MatchEvent.Died(victim, killer, AttackType.MELEE, now));
  }

  List<MatchEffect> click(CombatantId who, String bombId) {
    return ok(new MatchEvent.BombClicked(who, bombId, now));
  }

  Combatant member(CombatantId id) {
    return match.member(id).orElseThrow();
  }

  TeamColor teamOf(CombatantId id) {
    return member(id).team().orElseThrow();
  }

  /** The bomb {@code id} may arm on a Red-versus-Blue map. */
  String enemyBomb(CombatantId id) {
    return teamOf(id) == TeamColor.RED ? "blue-1" : "red-1";
  }

  /** The first living member on {@code team}. */
  Combatant anyOn(TeamColor team) {
    return match.members().stream()
        .filter(member -> member.alive() && member.onTeam(team))
        .findFirst()
        .orElseThrow();
  }

  List<Combatant> on(TeamColor team) {
    return match.members().stream().filter(member -> member.onTeam(team)).toList();
  }

  /** The test combatants' names, from the last character of their UUID. */
  static String name(CombatantId id) {
    return switch (id.uuid().toString().substring(35)) {
      case "a" -> "Alice";
      case "b" -> "Bob";
      case "c" -> "Carol";
      case "d" -> "Dave";
      case "e" -> "Erin";
      case "f" -> "Frank";
      case "1" -> "Rusher";
      case "2" -> "Camper";
      default -> throw new IllegalArgumentException("not a test combatant: " + id);
    };
  }
}
