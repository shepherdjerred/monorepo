package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.game.Member.Fighter;
import com.shepherdjerred.thestorm.arena.domain.game.Member.InLobby;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Countdown;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Fighting;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Intermission;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Lobby;
import com.shepherdjerred.thestorm.arena.domain.reward.RewardLedger;
import com.shepherdjerred.thestorm.arena.domain.wave.ResolvedWave;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** The countdown, the waves, rewards and the end of a game. */
final class Waves {

  private Waves() {}

  static void tick(Draft draft, Instant now, int alive) {
    switch (draft.phase) {
      case Lobby _ -> {
        if (canStart(draft)) {
          draft.phase = new Countdown(now.plus(draft.setup.countdown()));
          draft.announce(
              Notice.of(NoticeKind.COUNTDOWN, "seconds", draft.setup.countdown().toSeconds()));
        }
      }
      case Countdown countdown -> {
        if (!canStart(draft)) {
          draft.phase = new Lobby();
          draft.announce(Notice.of(NoticeKind.COUNTDOWN_CANCELLED));
        } else if (!now.isBefore(countdown.startsAt())) {
          start(draft, now);
        }
      }
      case Intermission intermission -> {
        if (!now.isBefore(intermission.at())) {
          startWave(draft, intermission.nextWave(), now, alive);
        }
      }
      case Fighting fighting -> fight(draft, fighting, now, alive);
    }
  }

  /** Enough players are in the lobby and every one of them is ready (so has a class). */
  static boolean canStart(Draft draft) {
    var lobby = draft.lobby();
    return lobby.size() >= draft.setup.minPlayers() && lobby.stream().allMatch(InLobby::ready);
  }

  static Optional<GameError> forceStart(Draft draft, Instant now) {
    if (draft.phase.running()) {
      return Optional.of(GameError.NOTHING_TO_START);
    }
    var lobby = draft.lobby();
    if (lobby.stream().noneMatch(member -> member.kit().isPresent())) {
      return Optional.of(GameError.NOTHING_TO_START);
    }
    for (var member : lobby) {
      if (member.kit().isEmpty()) {
        draft.remove(member.id());
        draft.effect(new GameEffect.Restore(member.id()));
        draft.tell(member.id(), Notice.of(NoticeKind.REMOVED_WITHOUT_CLASS));
      }
    }
    start(draft, now);
    return Optional.empty();
  }

  /** The gates open: lobby players become fighters and wave 1 is scheduled. */
  private static void start(Draft draft, Instant now) {
    var setup = draft.setup;
    draft.effect(new GameEffect.PrepareArena());
    var index = 0;
    for (var member : draft.lobby()) {
      var kit = member.kit().orElseThrow();
      draft.put(new Fighter(member.id(), member.name(), kit, 0));
      draft.effect(new GameEffect.Equip(member.id(), kit));
      draft.effect(new GameEffect.SendToArena(member.id(), index % setup.playerSpawns(), kit));
      index++;
    }
    draft.announce(
        Notice.of(
            NoticeKind.GAME_STARTED,
            Map.of(
                "arena", setup.arenaName(),
                "tier", setup.tier().name(),
                "waves", String.valueOf(setup.table().finalWave()))));
    draft.ledger = RewardLedger.EMPTY;
    draft.phase = new Intermission(1, now.plus(setup.timing().firstWave()));
  }

  private static void startWave(Draft draft, int number, Instant now, int alive) {
    var fighters = draft.fighters();
    if (fighters.isEmpty()) {
      throw new IllegalStateException("a wave cannot start without fighters");
    }
    var wave = draft.setup.wave(number, fighters.size());
    for (var fighter : fighters) {
      draft.put(fighter.reaching(number));
    }
    draft.announce(announcement(wave));
    if (wave.kind() == WaveKind.UPGRADE) {
      for (var fighter : fighters) {
        draft.effect(new GameEffect.Upgrade(fighter.id(), fighter.kit()));
      }
    }
    var room = draft.setup.timing().entityCap() - alive;
    if (wave.boss().isPresent()) {
      var boss = wave.boss().orElseThrow();
      draft.effect(new GameEffect.SpawnBoss(boss));
      room -= boss.entities();
    }
    release(draft, new Fighting(number, wave.units(), now), room);
  }

  private static Notice announcement(ResolvedWave wave) {
    var number = String.valueOf(wave.number());
    return switch (wave.kind()) {
      case STANDARD -> Notice.of(NoticeKind.WAVE_STARTED, "wave", number);
      case SWARM -> Notice.of(NoticeKind.SWARM_WAVE, "wave", number);
      case CAVALRY -> Notice.of(NoticeKind.CAVALRY_WAVE, "wave", number);
      case UPGRADE -> Notice.of(NoticeKind.UPGRADE_WAVE, "wave", number);
      case BOSS ->
          Notice.of(
              NoticeKind.BOSS_WAVE,
              Map.of(
                  "wave",
                  number,
                  "boss",
                  wave.boss().map(boss -> boss.boss().name()).orElseThrow()));
    };
  }

  /** Spawns as much of the queue, in order, as fits in {@code room}; the rest waits. */
  private static void release(Draft draft, Fighting fighting, int room) {
    var batch = new ArrayList<SpawnUnit>();
    var queue = fighting.queue();
    var left = room;
    var taken = 0;
    while (taken < queue.size() && queue.get(taken).entities() <= left) {
      left -= queue.get(taken).entities();
      batch.add(queue.get(taken));
      taken++;
    }
    if (!batch.isEmpty()) {
      draft.effect(new GameEffect.Spawn(batch));
    }
    draft.phase =
        new Fighting(fighting.wave(), queue.subList(taken, queue.size()), fighting.startedAt());
  }

  private static void fight(Draft draft, Fighting fighting, Instant now, int alive) {
    var setup = draft.setup;
    if (fighting.queue().isEmpty() && alive == 0) {
      cleared(draft, fighting.wave(), now);
      return;
    }
    var timedOut = !now.isBefore(fighting.startedAt().plus(setup.timing().timeout()));
    if (timedOut && fighting.wave() < setup.table().finalWave()) {
      startWave(draft, fighting.wave() + 1, now, alive);
      return;
    }
    release(draft, fighting, setup.timing().entityCap() - alive);
  }

  private static void cleared(Draft draft, int wave, Instant now) {
    draft.announce(Notice.of(NoticeKind.WAVE_CLEARED, "wave", wave));
    reward(draft, wave);
    if (wave == draft.setup.table().finalWave()) {
      victory(draft, wave);
    } else {
      draft.phase = new Intermission(wave + 1, now.plus(draft.setup.timing().between()));
    }
  }

  private static void reward(Draft draft, int wave) {
    var setup = draft.setup;
    var rewards = setup.rewards();
    var amount = rewards.waveReward(wave, setup.table().kind(wave), setup.tier());
    var milestone = rewards.vault().at(wave);
    for (var fighter : draft.fighters()) {
      var grant = draft.ledger.grant(fighter.id(), amount, rewards.capPerGame());
      draft.ledger = grant.ledger();
      if (grant.amount() > 0) {
        draft.effect(new GameEffect.PayReward(fighter.id(), grant.amount(), wave));
      }
      if (milestone.isPresent()) {
        draft.effect(new GameEffect.ClaimVault(fighter.id(), wave));
      }
    }
  }

  private static void victory(Draft draft, int wave) {
    draft.announce(
        Notice.of(
            NoticeKind.VICTORY,
            Map.of("arena", draft.setup.arenaName(), "wave", String.valueOf(wave))));
    for (var fighter : draft.fighters()) {
      Roster.record(draft, fighter);
      draft.effect(new GameEffect.Restore(fighter.id()));
      draft.remove(fighter.id());
    }
    close(draft);
  }

  /**
   * Ends the game in defeat if waves are under way and no fighter is left. {@code alsoTell} are
   * players who just left the game but should still hear the result.
   */
  static void defeatIfNobodyFights(Draft draft, List<UUID> alsoTell) {
    if (!draft.phase.running() || !draft.fighters().isEmpty()) {
      return;
    }
    var audience = new ArrayList<>(draft.audience());
    audience.addAll(alsoTell);
    draft.announce(
        List.copyOf(audience),
        Notice.of(
            NoticeKind.DEFEAT,
            Map.of("arena", draft.setup.arenaName(), "wave", String.valueOf(currentWave(draft)))));
    close(draft);
  }

  private static int currentWave(Draft draft) {
    return switch (draft.phase) {
      case Fighting fighting -> fighting.wave();
      case Intermission intermission -> intermission.nextWave() - 1;
      case Lobby _, Countdown _ -> 0;
    };
  }

  /**
   * Resets the arena if a game was running, restores the remaining spectators and empties the
   * arena. Players still joining are dropped; their snapshots are forgotten when they arrive.
   */
  static void close(Draft draft) {
    if (draft.phase.running()) {
      draft.effect(new GameEffect.ResetArena());
    }
    for (var watcher : draft.watchers()) {
      draft.effect(new GameEffect.Restore(watcher.id()));
    }
    for (var member : draft.members()) {
      draft.remove(member.id());
    }
    draft.phase = new Lobby();
    draft.ledger = RewardLedger.EMPTY;
  }
}
