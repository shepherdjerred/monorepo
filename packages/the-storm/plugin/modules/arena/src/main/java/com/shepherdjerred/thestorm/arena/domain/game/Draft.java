package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.reward.RewardLedger;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * A game being changed by one event: a mutable copy plus the effects collected so far. Never
 * escapes a transition; {@link #step} freezes it.
 */
final class Draft {

  final Setup setup;
  Phase phase;
  RewardLedger ledger;
  private final List<Member> members;
  private final List<GameEffect> effects = new ArrayList<>();

  Draft(ArenaGame game) {
    this.setup = game.setup();
    this.phase = game.phase();
    this.ledger = game.ledger();
    this.members = new ArrayList<>(game.members());
  }

  Optional<Member> member(UUID id) {
    return members.stream().filter(member -> member.id().equals(id)).findFirst();
  }

  /** Replaces the member with the same id, or adds {@code member} at the end. */
  void put(Member member) {
    for (var i = 0; i < members.size(); i++) {
      if (members.get(i).id().equals(member.id())) {
        members.set(i, member);
        return;
      }
    }
    members.add(member);
  }

  void remove(UUID id) {
    members.removeIf(member -> member.id().equals(id));
  }

  List<Member> members() {
    return List.copyOf(members);
  }

  List<Member.Fighter> fighters() {
    return members.stream()
        .filter(Member.Fighter.class::isInstance)
        .map(Member.Fighter.class::cast)
        .toList();
  }

  List<Member.InLobby> lobby() {
    return members.stream()
        .filter(Member.InLobby.class::isInstance)
        .map(Member.InLobby.class::cast)
        .toList();
  }

  List<Member.Watcher> watchers() {
    return members.stream()
        .filter(Member.Watcher.class::isInstance)
        .map(Member.Watcher.class::cast)
        .toList();
  }

  /** Everyone who has arrived (not pending): who hears announcements. */
  List<UUID> audience() {
    return members.stream()
        .filter(member -> !(member instanceof Member.Pending))
        .map(Member::id)
        .toList();
  }

  void effect(GameEffect effect) {
    effects.add(effect);
  }

  /** Tells everyone who has arrived. */
  void announce(Notice notice) {
    announce(audience(), notice);
  }

  void announce(List<UUID> to, Notice notice) {
    if (!to.isEmpty()) {
      effects.add(new GameEffect.Announce(to, notice));
    }
  }

  void tell(UUID player, Notice notice) {
    announce(List.of(player), notice);
  }

  ArenaGame.Step step() {
    return new ArenaGame.Step(new ArenaGame(setup, phase, members, ledger), List.copyOf(effects));
  }
}
