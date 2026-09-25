package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.game.Member.Fighter;
import com.shepherdjerred.thestorm.arena.domain.game.Member.InLobby;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Pending;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Role;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Watcher;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Players arriving, picking classes, leaving and dying. */
final class Roster {

  private Roster() {}

  static Optional<GameError> join(Draft draft, GameEvent.Join join) {
    if (draft.member(join.player()).isPresent()) {
      return Optional.of(GameError.ALREADY_JOINED);
    }
    if (draft.phase.running()) {
      return Optional.of(GameError.IN_PROGRESS);
    }
    if (players(draft) >= draft.setup.maxPlayers()) {
      return Optional.of(GameError.FULL);
    }
    draft.put(new Pending(join.player(), join.name(), Role.PLAYER));
    draft.effect(new GameEffect.CaptureSnapshot(join.player()));
    return Optional.empty();
  }

  static Optional<GameError> spectate(Draft draft, GameEvent.Spectate spectate) {
    if (draft.member(spectate.player()).isPresent()) {
      return Optional.of(GameError.ALREADY_JOINED);
    }
    draft.put(new Pending(spectate.player(), spectate.name(), Role.SPECTATOR));
    draft.effect(new GameEffect.CaptureSnapshot(spectate.player()));
    return Optional.empty();
  }

  /** Players, as opposed to spectators, counting those still joining. */
  private static long players(Draft draft) {
    return draft.members().stream()
        .filter(
            member ->
                switch (member) {
                  case Pending pending -> pending.role() == Role.PLAYER;
                  case InLobby _, Fighter _ -> true;
                  case Watcher _ -> false;
                })
        .count();
  }

  static void stored(Draft draft, UUID player) {
    var member = draft.member(player);
    if (member.isEmpty()) {
      // They left while the snapshot was being written and were restored from memory; the row
      // written since must go too.
      draft.effect(new GameEffect.ForgetSnapshot(player));
      return;
    }
    if (!(member.orElseThrow() instanceof Pending pending)) {
      throw new IllegalStateException(player + " had a snapshot stored twice");
    }
    switch (pending.role()) {
      case PLAYER -> arriveAsPlayer(draft, pending);
      case SPECTATOR -> {
        draft.put(new Watcher(pending.id(), pending.name()));
        draft.effect(new GameEffect.EnterSpectator(pending.id()));
        draft.tell(
            pending.id(), Notice.of(NoticeKind.SPECTATING, "arena", draft.setup.arenaName()));
      }
    }
  }

  private static void arriveAsPlayer(Draft draft, Pending pending) {
    if (draft.phase.running()) {
      draft.remove(pending.id());
      draft.effect(new GameEffect.Restore(pending.id()));
      draft.tell(pending.id(), Notice.of(NoticeKind.STARTED_WITHOUT_YOU));
      return;
    }
    draft.put(new InLobby(pending.id(), pending.name(), Optional.empty(), false));
    draft.effect(new GameEffect.EnterLobby(pending.id()));
    draft.announce(
        Notice.of(
            NoticeKind.JOINED, Map.of("player", pending.name(), "arena", draft.setup.arenaName())));
  }

  /**
   * The snapshot could not be stored; the adapter has already put the player back from memory, so
   * they only leave the arena.
   */
  static void failed(Draft draft, UUID player) {
    draft.member(player).filter(Pending.class::isInstance).ifPresent(m -> draft.remove(player));
  }

  static Optional<GameError> pickClass(Draft draft, GameEvent.PickClass pick) {
    return switch (inLobby(draft, pick.player())) {
      case Lookup.Refused(var error) -> Optional.of(error);
      case Lookup.Found(var member) -> {
        var name = draft.setup.classNames().get(pick.kit());
        if (name == null) {
          yield Optional.of(GameError.UNKNOWN_CLASS);
        }
        if (!pick.permitted()) {
          yield Optional.of(GameError.CLASS_LOCKED);
        }
        draft.put(member.withKit(pick.kit()));
        draft.effect(new GameEffect.Equip(member.id(), pick.kit()));
        draft.tell(member.id(), Notice.of(NoticeKind.CLASS_PICKED, "class", name));
        yield Optional.empty();
      }
    };
  }

  static Optional<GameError> ready(Draft draft, UUID player) {
    return switch (inLobby(draft, player)) {
      case Lookup.Refused(var error) -> Optional.of(error);
      case Lookup.Found(var member) -> {
        if (member.kit().isEmpty()) {
          yield Optional.of(GameError.NO_CLASS);
        }
        if (!member.ready()) {
          draft.put(member.asReady());
          draft.announce(Notice.of(NoticeKind.READY, "player", member.name()));
        }
        yield Optional.empty();
      }
    };
  }

  private sealed interface Lookup {
    record Found(InLobby member) implements Lookup {}

    record Refused(GameError error) implements Lookup {}
  }

  private static Lookup inLobby(Draft draft, UUID player) {
    var member = draft.member(player);
    if (member.isEmpty()) {
      return new Lookup.Refused(GameError.NOT_A_MEMBER);
    }
    return member.orElseThrow() instanceof InLobby lobby
        ? new Lookup.Found(lobby)
        : new Lookup.Refused(GameError.NOT_IN_LOBBY);
  }

  /**
   * A member leaves or disconnects: restored now, wherever they were in the flow. A player still
   * joining was already emptied when their snapshot was taken, so they are restored too.
   */
  static void leave(Draft draft, Member member) {
    switch (member) {
      case Pending pending -> {
        draft.remove(pending.id());
        draft.effect(new GameEffect.Restore(pending.id()));
      }
      case InLobby lobby -> {
        draft.announce(Notice.of(NoticeKind.LEFT, "player", lobby.name()));
        draft.remove(lobby.id());
        draft.effect(new GameEffect.Restore(lobby.id()));
      }
      case Fighter fighter -> {
        draft.announce(Notice.of(NoticeKind.LEFT, "player", fighter.name()));
        draft.remove(fighter.id());
        record(draft, fighter);
        draft.effect(new GameEffect.Restore(fighter.id()));
        Waves.defeatIfNobodyFights(draft, List.of(fighter.id()));
      }
      case Watcher watcher -> {
        draft.remove(watcher.id());
        draft.effect(new GameEffect.Restore(watcher.id()));
      }
    }
  }

  /** A member died: restored once they respawn. */
  static void died(Draft draft, Member member) {
    switch (member) {
      case Pending pending -> {
        draft.remove(pending.id());
        draft.effect(new GameEffect.RestoreAfterRespawn(pending.id()));
      }
      case InLobby lobby -> {
        draft.announce(Notice.of(NoticeKind.LEFT, "player", lobby.name()));
        draft.remove(lobby.id());
        draft.effect(new GameEffect.RestoreAfterRespawn(lobby.id()));
      }
      case Fighter fighter -> {
        draft.announce(
            Notice.of(
                NoticeKind.DIED,
                Map.of("player", fighter.name(), "wave", String.valueOf(fighter.reached()))));
        draft.remove(fighter.id());
        record(draft, fighter);
        draft.effect(new GameEffect.RestoreAfterRespawn(fighter.id()));
        Waves.defeatIfNobodyFights(draft, List.of(fighter.id()));
      }
      case Watcher watcher -> {
        draft.remove(watcher.id());
        draft.effect(new GameEffect.RestoreAfterRespawn(watcher.id()));
      }
    }
  }

  /** Everyone is restored and the arena reset: an admin stop or the plugin shutting down. */
  static void stop(Draft draft) {
    for (var member : draft.members()) {
      switch (member) {
        case Pending pending -> draft.effect(new GameEffect.Restore(pending.id()));
        case InLobby lobby -> draft.effect(new GameEffect.Restore(lobby.id()));
        case Fighter fighter -> {
          record(draft, fighter);
          draft.effect(new GameEffect.Restore(fighter.id()));
        }
        case Watcher watcher -> draft.effect(new GameEffect.Restore(watcher.id()));
      }
      draft.remove(member.id());
    }
    Waves.close(draft);
  }

  /** Records how far a fighter got, once they reached wave 1. */
  static void record(Draft draft, Fighter fighter) {
    if (fighter.reached() > 0) {
      draft.effect(new GameEffect.RecordBestWave(fighter.id(), fighter.name(), fighter.reached()));
    }
  }
}
