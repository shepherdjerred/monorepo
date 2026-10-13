package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;

/** Drives kit abilities through events in tests, keeping the latest state. */
final class Bout {

  Abilities abilities = Abilities.NONE;
  Instant now = Samples.T0;
  final List<Fighter> fighters = new ArrayList<>();
  final List<BlockPos> bombs = new ArrayList<>();

  /** What the map's blocks say about a spot when a tick reads them; everywhere is safe at first. */
  Ground ground = feet -> true;

  private long rolls;

  /** Adds a living fighter. */
  Bout with(CombatantId id, TeamColor team, String kit) {
    fighters.add(new Fighter(id, name(id), team, kit, true));
    return this;
  }

  /** The name {@code id} fights under here. */
  String name(CombatantId id) {
    return id.uuid().toString().substring(0, 4);
  }

  Abilities.Board board() {
    return new Abilities.Board(
        now, new SplittableRandom(Samples.SEED + rolls++), fighters, bombs, false, ground);
  }

  /** Players on the server as the match goes live; a test sets it for the Medic's rule. */
  int online = 22;

  List<AbilityEffect> start() {
    return keep(Abilities.start(board(), online));
  }

  List<AbilityEffect> end() {
    return keep(abilities.ended(board()));
  }

  List<AbilityEffect> act(CombatantId actor, AbilityInput input) {
    return keep(abilities.act(board(), actor, input));
  }

  List<AbilityEffect> hit(
      CombatantId attacker, CombatantId victim, AttackType type, String weapon) {
    return act(attacker, new AbilityInput.Hit(victim, type, Optional.of(weapon), 4, 16, 20));
  }

  List<AbilityEffect> tick(Map<CombatantId, Motion> motions) {
    return keep(abilities.tick(board(), motions));
  }

  /** {@code victim} dies, killed by {@code killer} with {@code assists}. */
  List<AbilityEffect> die(
      CombatantId victim, Optional<CombatantId> killer, Map<CombatantId, Double> assists) {
    for (var i = 0; i < fighters.size(); i++) {
      var fighter = fighters.get(i);
      if (fighter.id().equals(victim)) {
        fighters.set(
            i, new Fighter(fighter.id(), fighter.name(), fighter.team(), fighter.kit(), false));
      }
    }
    return keep(
        abilities.died(
            board(),
            new Death(
                victim,
                killer,
                assists,
                AttackType.MELEE,
                Optional.ofNullable(abilities.positions().get(victim)))));
  }

  List<AbilityEffect> kill(CombatantId victim, CombatantId killer) {
    return die(victim, Optional.of(killer), Map.of());
  }

  void advance(Duration by) {
    now = now.plus(by);
  }

  <S extends KitState> S state(CombatantId id, Class<S> type) {
    return type.cast(abilities.state(id));
  }

  private List<AbilityEffect> keep(Abilities.Step step) {
    abilities = step.abilities();
    return step.effects();
  }

  /** Standing still at {@code at}, healthy, on the ground. */
  static Motion still(Vec3 at) {
    return new Motion(at, Vec3.ZERO, 0, 0, false, false, true, 20, 20, false, false, true);
  }

  static Map<CombatantId, Motion> motions(Map<CombatantId, Motion> by) {
    return new HashMap<>(by);
  }
}
