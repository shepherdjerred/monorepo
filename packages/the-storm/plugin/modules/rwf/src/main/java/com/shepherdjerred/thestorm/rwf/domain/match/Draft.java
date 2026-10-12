package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.random.RandomGenerator;

/**
 * A match being changed by one event: a mutable copy plus the effects collected so far. Never
 * escapes a transition; {@link #step} freezes it.
 */
final class Draft {

  final MatchSettings settings;
  final UUID matchId;
  final long seed;
  Phase phase;
  Optional<MapDefinition> map;
  private final List<Combatant> members;
  private final List<Combatant> departed;
  private final List<Bomb> bombs;
  private final List<MatchEffect> effects = new ArrayList<>();

  Draft(RwfMatch match) {
    this.settings = match.settings();
    this.matchId = match.matchId();
    this.seed = match.seed();
    this.phase = match.phase();
    this.map = match.map();
    this.members = new ArrayList<>(match.members());
    this.departed = new ArrayList<>(match.departed());
    this.bombs = new ArrayList<>(match.bombs());
  }

  MapDefinition map() {
    return map.orElseThrow(() -> new IllegalStateException("no map chosen"));
  }

  Optional<Combatant> member(CombatantId id) {
    return members.stream().filter(member -> member.id().equals(id)).findFirst();
  }

  /** Replaces the member with the same id, or adds {@code member} at the end. */
  void put(Combatant member) {
    for (var i = 0; i < members.size(); i++) {
      if (members.get(i).id().equals(member.id())) {
        members.set(i, member);
        return;
      }
    }
    members.add(member);
  }

  void remove(CombatantId id) {
    members.removeIf(member -> member.id().equals(id));
  }

  /** Moves a member who left mid-match to the departed list, for rewards. */
  void depart(Combatant member) {
    remove(member.id());
    departed.add(member);
  }

  void clearRoster() {
    members.clear();
    departed.clear();
  }

  List<Combatant> members() {
    return List.copyOf(members);
  }

  List<Combatant> departed() {
    return List.copyOf(departed);
  }

  List<CombatantId> ids() {
    return members.stream().map(Combatant::id).toList();
  }

  List<Combatant> alive() {
    return members.stream().filter(Combatant::alive).toList();
  }

  List<Combatant> aliveOn(TeamColor team) {
    return members.stream().filter(m -> m.alive() && m.onTeam(team)).toList();
  }

  List<Bomb> bombs() {
    return List.copyOf(bombs);
  }

  Optional<Bomb> bomb(String id) {
    return bombs.stream().filter(bomb -> bomb.id().equals(id)).findFirst();
  }

  void putBomb(Bomb bomb) {
    for (var i = 0; i < bombs.size(); i++) {
      if (bombs.get(i).id().equals(bomb.id())) {
        bombs.set(i, bomb);
        return;
      }
    }
    bombs.add(bomb);
  }

  void setBombs(List<Bomb> fresh) {
    bombs.clear();
    bombs.addAll(fresh);
  }

  /** The match's randomness at {@code now}, derived from the seed so replays agree. */
  RandomGenerator random(Instant now) {
    return new SplittableRandom(seed ^ now.toEpochMilli());
  }

  void effect(MatchEffect effect) {
    effects.add(effect);
  }

  void announce(Notice notice) {
    effects.add(new MatchEffect.Announce(notice));
  }

  void tell(CombatantId to, Notice notice) {
    effects.add(new MatchEffect.Tell(List.of(to), notice));
  }

  void sound(List<CombatantId> to, SoundCue cue) {
    if (!to.isEmpty()) {
      effects.add(new MatchEffect.Sound(to, cue));
    }
  }

  RwfMatch.Step step() {
    return new RwfMatch.Step(
        new RwfMatch(settings, matchId, seed, phase, map, members, departed, bombs),
        List.copyOf(effects));
  }
}
