package com.shepherdjerred.thestorm.arena.domain.game;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.arena.testing.Samples.DAVE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.Announce;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.CaptureSnapshot;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.ClaimVault;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.EnterLobby;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.EnterSpectator;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.Equip;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.ForgetSnapshot;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.PayReward;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.PrepareArena;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.RecordBestWave;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.ResetArena;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.Restore;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.RestoreAfterRespawn;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.SendToArena;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.Spawn;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.SpawnBoss;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect.Upgrade;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Died;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Disconnect;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.ForceStart;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Join;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Leave;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.PickClass;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Ready;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.SnapshotFailed;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.SnapshotStored;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Spectate;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent.Stop;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Fighter;
import com.shepherdjerred.thestorm.arena.domain.game.Member.InLobby;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Pending;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Role;
import com.shepherdjerred.thestorm.arena.domain.game.Member.Watcher;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Countdown;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Fighting;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Intermission;
import com.shepherdjerred.thestorm.arena.domain.game.Phase.Lobby;
import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class ArenaGameTest {

  private final Play play = new Play(Samples.setup(), T0);

  private static List<NoticeKind> notices(List<GameEffect> effects) {
    return effects.stream()
        .filter(Announce.class::isInstance)
        .map(effect -> ((Announce) effect).notice().kind())
        .toList();
  }

  private static <T extends GameEffect> List<T> only(List<GameEffect> effects, Class<T> type) {
    return effects.stream().filter(type::isInstance).map(type::cast).toList();
  }

  @Nested
  final class Joining {

    @Test
    void joiningStoresASnapshotBeforeTouchingAnything() {
      var effects = play.ok(new Join(ALICE, "Alice"));

      assertThat(effects).containsExactly(new CaptureSnapshot(ALICE));
      assertThat(play.member(ALICE)).isEqualTo(new Pending(ALICE, "Alice", Role.PLAYER));
    }

    @Test
    void theStoredSnapshotLetsThePlayerIntoTheLobby() {
      play.ok(new Join(ALICE, "Alice"));

      var effects = play.ok(new SnapshotStored(ALICE));

      assertThat(effects.getFirst()).isEqualTo(new EnterLobby(ALICE));
      assertThat(notices(effects)).containsExactly(NoticeKind.JOINED);
      assertThat(play.member(ALICE))
          .isEqualTo(new InLobby(ALICE, "Alice", Optional.empty(), false));
    }

    @Test
    void aFailedSnapshotDropsThePlayerUntouched() {
      play.ok(new Join(ALICE, "Alice"));

      var effects = play.ok(new SnapshotFailed(ALICE));

      assertThat(effects).isEmpty();
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void aFailedSnapshotForSomeoneWhoLeftChangesNothing() {
      assertThat(play.ok(new SnapshotFailed(ALICE))).isEmpty();
    }

    @Test
    void aPlayerCannotJoinTwice() {
      play.ok(new Join(ALICE, "Alice"));

      assertThat(play.refused(new Join(ALICE, "Alice"))).isEqualTo(GameError.ALREADY_JOINED);
      assertThat(play.refused(new Spectate(ALICE, "Alice"))).isEqualTo(GameError.ALREADY_JOINED);
    }

    @Test
    void playersStillJoiningCountTowardsTheLimit() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new Join(BOB, "Bob"));
      play.ok(new Join(CAROL, "Carol"));

      assertThat(play.refused(new Join(DAVE, "Dave"))).isEqualTo(GameError.FULL);
    }

    @Test
    void spectatorsDoNotCountTowardsTheLimit() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new Join(BOB, "Bob"));

      play.ok(new Join(CAROL, "Carol"));
    }

    @Test
    void leavingWhileJoiningRestoresAndForgetsTheSnapshotWhenItArrives() {
      play.ok(new Join(ALICE, "Alice"));
      assertThat(play.ok(new Leave(ALICE))).containsExactly(new Restore(ALICE));

      var effects = play.ok(new SnapshotStored(ALICE));

      assertThat(effects).containsExactly(new ForgetSnapshot(ALICE));
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void disconnectingWhileJoiningAlsoRestoresAndForgets() {
      play.ok(new Join(ALICE, "Alice"));
      assertThat(play.ok(new Disconnect(ALICE))).containsExactly(new Restore(ALICE));

      assertThat(play.ok(new SnapshotStored(ALICE))).containsExactly(new ForgetSnapshot(ALICE));
    }

    @Test
    void aSecondStoredSnapshotIsABug() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));

      assertThatThrownBy(() -> play.game.on(new SnapshotStored(ALICE)))
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Nested
  final class Spectating {

    @Test
    void aSpectatorWatchesAfterTheirSnapshotIsStored() {
      assertThat(play.ok(new Spectate(DAVE, "Dave"))).containsExactly(new CaptureSnapshot(DAVE));

      var effects = play.ok(new SnapshotStored(DAVE));

      assertThat(effects.getFirst()).isEqualTo(new EnterSpectator(DAVE));
      assertThat(notices(effects)).containsExactly(NoticeKind.SPECTATING);
      assertThat(play.member(DAVE)).isEqualTo(new Watcher(DAVE, "Dave"));
    }

    @Test
    void spectatorsMayArriveDuringAGame() {
      play.start(ALICE);

      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));

      assertThat(play.member(DAVE)).isInstanceOf(Watcher.class);
    }

    @Test
    void aSpectatorLeavingIsRestored() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));

      assertThat(play.ok(new Leave(DAVE))).containsExactly(new Restore(DAVE));
    }

    @Test
    void spectatorsHearAnnouncements() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));
      play.ok(new Join(ALICE, "Alice"));

      var effects = play.ok(new SnapshotStored(ALICE));

      assertThat(only(effects, Announce.class).getFirst().to()).containsExactly(DAVE, ALICE);
    }
  }

  @Nested
  final class Classes {

    @Test
    void pickingAClassEquipsIt() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));

      var effects = play.ok(new PickClass(ALICE, "knight", true));

      assertThat(effects.getFirst()).isEqualTo(new Equip(ALICE, "knight"));
      assertThat(notices(effects)).containsExactly(NoticeKind.CLASS_PICKED);
      assertThat(((InLobby) play.member(ALICE)).kit()).contains("knight");
    }

    @Test
    void theClassNoticeNamesTheClass() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));

      var effects = play.ok(new PickClass(ALICE, "archer", true));

      assertThat(only(effects, Announce.class).getFirst().notice().values())
          .containsEntry("class", "Archer");
    }

    @Test
    void refusals() {
      assertThat(play.refused(new PickClass(ALICE, "knight", true)))
          .isEqualTo(GameError.NOT_A_MEMBER);
      play.ok(new Join(ALICE, "Alice"));
      assertThat(play.refused(new PickClass(ALICE, "knight", true)))
          .isEqualTo(GameError.NOT_IN_LOBBY);
      play.ok(new SnapshotStored(ALICE));
      assertThat(play.refused(new PickClass(ALICE, "wizard", true)))
          .isEqualTo(GameError.UNKNOWN_CLASS);
      assertThat(play.refused(new PickClass(ALICE, "archer", false)))
          .isEqualTo(GameError.CLASS_LOCKED);
    }

    @Test
    void readyNeedsAClass() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));

      assertThat(play.refused(new Ready(ALICE))).isEqualTo(GameError.NO_CLASS);
      assertThat(play.refused(new Ready(BOB))).isEqualTo(GameError.NOT_A_MEMBER);
    }

    @Test
    void readyIsAnnouncedOnce() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));
      play.ok(new PickClass(ALICE, "knight", true));

      assertThat(notices(play.ok(new Ready(ALICE)))).containsExactly(NoticeKind.READY);
      assertThat(play.ok(new Ready(ALICE))).isEmpty();
    }

    @Test
    void classesCannotChangeOnceTheGameStarts() {
      play.start(ALICE);

      assertThat(play.refused(new PickClass(ALICE, "archer", true)))
          .isEqualTo(GameError.NOT_IN_LOBBY);
      assertThat(play.refused(new Ready(ALICE))).isEqualTo(GameError.NOT_IN_LOBBY);
    }
  }

  @Nested
  final class Countdowns {

    @Test
    void theCountdownStartsWhenEveryoneIsReady() {
      play.arrive(ALICE, "knight");

      var effects = play.tick(1, 0);

      assertThat(play.game.phase()).isEqualTo(new Countdown(play.now.plusSeconds(10)));
      assertThat(notices(effects)).containsExactly(NoticeKind.COUNTDOWN);
    }

    @Test
    void anUnreadyPlayerHoldsTheCountdown() {
      play.arrive(ALICE, "knight");
      play.ok(new Join(BOB, "Bob"));
      play.ok(new SnapshotStored(BOB));

      play.tick(1, 0);

      assertThat(play.game.phase()).isEqualTo(new Lobby());
    }

    @Test
    void theArenaNeedsItsMinimumOfReadyPlayers() {
      var pair = new Play(Samples.setup(2, Samples.table()), T0);
      pair.arrive(ALICE, "knight");

      pair.tick(1, 0);
      assertThat(pair.game.phase()).isEqualTo(new Lobby());

      pair.arrive(BOB, "knight");
      pair.tick(1, 0);
      assertThat(pair.game.phase()).isInstanceOf(Countdown.class);
    }

    @Test
    void aNewArrivalCancelsTheCountdownUntilTheyAreReady() {
      play.arrive(ALICE, "knight");
      play.tick(1, 0);
      play.ok(new Join(BOB, "Bob"));
      play.ok(new SnapshotStored(BOB));

      var effects = play.tick(1, 0);

      assertThat(play.game.phase()).isEqualTo(new Lobby());
      assertThat(notices(effects)).containsExactly(NoticeKind.COUNTDOWN_CANCELLED);
    }

    @Test
    void theLastPlayerLeavingEmptiesTheArena() {
      play.arrive(ALICE, "knight");
      play.tick(1, 0);

      assertThat(play.ok(new Leave(ALICE))).contains(new Restore(ALICE));
      play.tick(1, 0);

      assertThat(play.game.phase()).isEqualTo(new Lobby());
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void theGatesOpenWhenTheCountdownEnds() {
      play.arrive(ALICE, "knight");
      play.arrive(BOB, "knight");
      play.arrive(CAROL, "archer");
      play.tick(1, 0);
      assertThat(play.tick(9, 0)).isEmpty();

      var effects = play.tick(1, 0);

      assertThat(effects.getFirst()).isInstanceOf(PrepareArena.class);
      assertThat(only(effects, SendToArena.class))
          .containsExactly(
              new SendToArena(ALICE, 0, "knight"),
              new SendToArena(BOB, 1, "knight"),
              new SendToArena(CAROL, 0, "archer"));
      assertThat(only(effects, Equip.class)).hasSize(3);
      assertThat(notices(effects)).containsExactly(NoticeKind.GAME_STARTED);
      assertThat(play.game.phase()).isEqualTo(new Intermission(1, play.now.plusSeconds(5)));
      assertThat(play.game.fighters()).extracting(Fighter::reached).containsOnly(0);
    }

    @Test
    void nobodyJoinsOnceTheGameStarts() {
      play.start(ALICE);

      assertThat(play.refused(new Join(BOB, "Bob"))).isEqualTo(GameError.IN_PROGRESS);
    }

    @Test
    void aJoinThatFinishesAfterTheStartIsTurnedAway() {
      play.arrive(ALICE, "knight");
      play.tick(1, 0);
      play.ok(new Join(BOB, "Bob"));
      play.tick(10, 0);
      assertThat(play.game.phase().running()).isTrue();

      var effects = play.ok(new SnapshotStored(BOB));

      assertThat(effects.getFirst()).isEqualTo(new Restore(BOB));
      assertThat(notices(effects)).containsExactly(NoticeKind.STARTED_WITHOUT_YOU);
      assertThat(play.game.member(BOB)).isEmpty();
    }
  }

  @Nested
  final class ForceStarts {

    @Test
    void anAdminStartSendsOutPlayersWithoutAClass() {
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));
      play.ok(new PickClass(ALICE, "knight", true));
      play.ok(new Join(BOB, "Bob"));
      play.ok(new SnapshotStored(BOB));

      var effects = play.ok(new ForceStart(T0));

      assertThat(effects).contains(new Restore(BOB), new SendToArena(ALICE, 0, "knight"));
      assertThat(notices(effects)).contains(NoticeKind.REMOVED_WITHOUT_CLASS);
      assertThat(play.game.member(BOB)).isEmpty();
      assertThat(play.member(ALICE)).isInstanceOf(Fighter.class);
    }

    @Test
    void thereMustBeSomeoneWithAClass() {
      assertThat(play.refused(new ForceStart(T0))).isEqualTo(GameError.NOTHING_TO_START);
      play.ok(new Join(ALICE, "Alice"));
      play.ok(new SnapshotStored(ALICE));
      assertThat(play.refused(new ForceStart(T0))).isEqualTo(GameError.NOTHING_TO_START);
    }

    @Test
    void aRunningGameCannotBeStartedAgain() {
      play.start(ALICE);

      assertThat(play.refused(new ForceStart(T0))).isEqualTo(GameError.NOTHING_TO_START);
    }
  }

  @Nested
  final class WavesRun {

    @Test
    void theFirstWaveSpawnsAfterThePause() {
      play.start(ALICE);

      assertThat(play.tick(4, 0)).isEmpty();
      var effects = play.tick(1, 0);

      assertThat(notices(effects)).containsExactly(NoticeKind.WAVE_STARTED);
      assertThat(only(effects, Spawn.class))
          .singleElement()
          .satisfies(s -> assertThat(s.units()).hasSize(2));
      assertThat(play.game.phase()).isInstanceOf(Fighting.class);
      assertThat(((Fighter) play.member(ALICE)).reached()).isEqualTo(1);
    }

    @Test
    void aWaveIsClearedWhenItsMobsAreDead() {
      play.start(ALICE);
      play.tick(5, 0);
      assertThat(play.tick(1, 2)).isEmpty();

      var effects = play.tick(1, 0);

      assertThat(notices(effects)).containsExactly(NoticeKind.WAVE_CLEARED);
      assertThat(play.game.phase()).isEqualTo(new Intermission(2, play.now.plusSeconds(5)));
    }

    @Test
    void theEntityCapHoldsBackTheRestOfAWave() {
      var crowd = new Play(Samples.setup(1, Samples.table(14)), T0);
      crowd.start(ALICE);

      var first = crowd.tick(5, 0);
      assertThat(only(first, Spawn.class).getFirst().units()).hasSize(10);
      assertThat(((Fighting) crowd.game.phase()).queue()).hasSize(4);

      assertThat(only(crowd.tick(1, 10), Spawn.class)).isEmpty();
      assertThat(only(crowd.tick(1, 7), Spawn.class).getFirst().units()).hasSize(3);
      assertThat(only(crowd.tick(1, 9), Spawn.class).getFirst().units()).hasSize(1);
      assertThat(crowd.tick(1, 1)).isEmpty();
      assertThat(notices(crowd.tick(1, 0))).containsExactly(NoticeKind.WAVE_CLEARED);
    }

    @Test
    void mobsAlreadyAliveCountAgainstTheCapWhenAWaveStarts() {
      var crowd = new Play(Samples.setup(1, Samples.table(14)), T0);
      crowd.start(ALICE);

      var effects = crowd.tick(5, 6);

      assertThat(only(effects, Spawn.class).getFirst().units()).hasSize(4);
    }

    @Test
    void aStuckWaveTimesOutIntoTheNextOne() {
      play.start(ALICE);
      play.tick(5, 0);

      assertThat(play.tick(59, 1)).isEmpty();
      var effects = play.tick(1, 1);

      assertThat(notices(effects)).containsExactly(NoticeKind.BOSS_WAVE);
      assertThat(play.game.phase()).isInstanceOf(Fighting.class);
      assertThat(((Fighting) play.game.phase()).wave()).isEqualTo(2);
    }

    @Test
    void theFinalWaveNeverTimesOut() {
      reachWave(4);

      assertThat(play.tick(600, 1)).isEmpty();
      assertThat(((Fighting) play.game.phase()).wave()).isEqualTo(4);
    }

    @Test
    void bossWavesNameTheBoss() {
      play.start(ALICE);
      play.tick(5, 0);
      play.tick(1, 0);

      var effects = play.tick(5, 0);

      assertThat(only(effects, SpawnBoss.class))
          .singleElement()
          .satisfies(spawn -> assertThat(spawn.boss().boss().name()).isEqualTo("The King"));
      var announce = only(effects, Announce.class).getFirst().notice();
      assertThat(announce.kind()).isEqualTo(NoticeKind.BOSS_WAVE);
      assertThat(announce.values()).containsEntry("boss", "The King").containsEntry("wave", "2");
    }

    @Test
    void anUpgradeWaveGivesEachFighterTheirUpgrade() {
      play.start(ALICE, BOB);
      play.tick(5, 0);
      play.tick(1, 0);
      play.tick(5, 0);
      play.tick(1, 0);

      var effects = play.tick(5, 0);

      assertThat(only(effects, Upgrade.class))
          .containsExactly(new Upgrade(ALICE, "knight"), new Upgrade(BOB, "knight"));
      assertThat(notices(effects)).containsExactly(NoticeKind.UPGRADE_WAVE);
    }

    /** Runs the solo game until {@code wave} has just started. */
    private void reachWave(int wave) {
      play.start(ALICE);
      reachWaveFrom(wave);
    }

    private void reachWaveFrom(int wave) {
      play.tick(5, 0);
      while (((Fighting) play.game.phase()).wave() < wave) {
        play.tick(1, 0);
        play.tick(5, 0);
      }
    }
  }

  @Nested
  final class Rewards {

    @Test
    void clearingABossWaveFromTheFirstRewardWavePaysEveryFighter() {
      play.start(ALICE, BOB);
      play.tick(5, 0);
      play.tick(1, 0);
      play.tick(5, 0);

      var effects = play.tick(1, 0);

      assertThat(only(effects, PayReward.class))
          .containsExactly(new PayReward(ALICE, 100, 2), new PayReward(BOB, 100, 2));
      assertThat(only(effects, ClaimVault.class))
          .containsExactly(new ClaimVault(ALICE, 2), new ClaimVault(BOB, 2));
    }

    @Test
    void ordinaryWavesPayNothing() {
      play.start(ALICE);
      play.tick(5, 0);

      assertThat(only(play.tick(1, 0), PayReward.class)).isEmpty();
    }

    @Test
    void thePerGameCapHolds() {
      play.start(ALICE);
      play.tick(5, 0);
      play.tick(1, 0);
      play.tick(5, 0);
      assertThat(only(play.tick(1, 0), PayReward.class))
          .containsExactly(new PayReward(ALICE, 100, 2));
      play.tick(5, 0);
      play.tick(1, 0);
      play.tick(5, 0);

      var effects = play.tick(1, 0);

      assertThat(only(effects, PayReward.class)).containsExactly(new PayReward(ALICE, 50, 4));
    }

    @Test
    void aHarderTierPaysMoreUpToAHigherCap() {
      var doubled = new Tier("Ominous V", 1, 1, 1, 2);
      var hard = new Play(Samples.setup(1, Samples.table(), doubled), T0);
      hard.start(ALICE);
      hard.tick(5, 0);
      hard.tick(1, 0);
      hard.tick(5, 0);
      assertThat(only(hard.tick(1, 0), PayReward.class))
          .containsExactly(new PayReward(ALICE, 200, 2));
      hard.tick(5, 0);
      hard.tick(1, 0);
      hard.tick(5, 0);

      var effects = hard.tick(1, 0);

      assertThat(only(effects, PayReward.class)).containsExactly(new PayReward(ALICE, 100, 4));
    }

    @Test
    void aFighterWhoDiedBeforeTheClearGetsNothing() {
      play.start(ALICE, BOB);
      play.tick(5, 0);
      play.tick(1, 0);
      play.tick(5, 0);
      play.ok(new Died(BOB));

      var effects = play.tick(1, 0);

      assertThat(only(effects, PayReward.class)).containsExactly(new PayReward(ALICE, 100, 2));
    }
  }

  @Nested
  final class Endings {

    @Test
    void clearingTheFinalWaveWins() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));
      play.start(ALICE);
      for (var i = 0; i < 3; i++) {
        play.tick(5, 0);
        play.tick(1, 0);
      }
      play.tick(5, 0);

      var effects = play.tick(1, 0);

      assertThat(notices(effects)).containsSubsequence(NoticeKind.WAVE_CLEARED, NoticeKind.VICTORY);
      assertThat(effects)
          .contains(
              new RecordBestWave(ALICE, "Alice", 4),
              new Restore(ALICE),
              new ResetArena(),
              new Restore(DAVE));
      assertThat(play.game.isEmpty()).isTrue();
      assertThat(play.game.phase()).isEqualTo(new Lobby());
      assertThat(play.game.ledger().paid()).isEmpty();
    }

    @Test
    void theLastFighterDyingEndsTheGame() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));
      play.start(ALICE);
      play.tick(5, 0);

      var effects = play.ok(new Died(ALICE));

      assertThat(notices(effects)).containsExactly(NoticeKind.DIED, NoticeKind.DEFEAT);
      var defeat = only(effects, Announce.class).get(1);
      assertThat(defeat.to()).containsExactlyInAnyOrder(DAVE, ALICE);
      assertThat(defeat.notice().values()).containsEntry("wave", "1");
      assertThat(effects)
          .contains(
              new RecordBestWave(ALICE, "Alice", 1),
              new RestoreAfterRespawn(ALICE),
              new ResetArena(),
              new Restore(DAVE));
      assertThat(effects).doesNotContain(new Restore(ALICE));
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void theEndOfAGameRestoresSpectatorsStillJoining() {
      play.start(ALICE);
      play.tick(5, 0);
      play.ok(new Spectate(DAVE, "Dave"));

      var effects = play.ok(new Died(ALICE));

      assertThat(effects).contains(new Restore(DAVE), new ResetArena());
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void theGameGoesOnWhileAFighterRemains() {
      play.start(ALICE, BOB);
      play.tick(5, 0);

      var effects = play.ok(new Died(ALICE));

      assertThat(notices(effects)).containsExactly(NoticeKind.DIED);
      assertThat(effects).doesNotContain(new ResetArena());
      assertThat(play.game.phase().running()).isTrue();
    }

    @Test
    void dyingBeforeWaveOneRecordsNothing() {
      play.start(ALICE, BOB);

      var effects = play.ok(new Died(ALICE));

      assertThat(only(effects, RecordBestWave.class)).isEmpty();
    }

    @Test
    void theLastFighterLeavingIsADefeatToo() {
      play.start(ALICE);
      play.tick(5, 0);
      play.tick(1, 0);

      var effects = play.ok(new Leave(ALICE));

      assertThat(effects).contains(new Restore(ALICE), new ResetArena());
      assertThat(notices(effects)).containsExactly(NoticeKind.LEFT, NoticeKind.DEFEAT);
      var defeat = only(effects, Announce.class).get(1).notice();
      assertThat(defeat.values()).containsEntry("wave", "1");
    }

    @Test
    void disconnectingMidGameIsLeaving() {
      play.start(ALICE, BOB);
      play.tick(5, 0);

      var effects = play.ok(new Disconnect(ALICE));

      assertThat(effects).contains(new RecordBestWave(ALICE, "Alice", 1), new Restore(ALICE));
      assertThat(play.game.member(ALICE)).isEmpty();
      assertThat(play.game.phase().running()).isTrue();
    }

    @Test
    void disconnectingOrDyingOutsideAnArenaChangesNothing() {
      assertThat(play.ok(new Disconnect(ALICE))).isEmpty();
      assertThat(play.ok(new Died(ALICE))).isEmpty();
      assertThat(play.refused(new Leave(ALICE))).isEqualTo(GameError.NOT_A_MEMBER);
    }

    @Test
    void dyingInTheLobbyRestoresAfterRespawning() {
      play.arrive(ALICE, "knight");

      var effects = play.ok(new Died(ALICE));

      assertThat(effects).contains(new RestoreAfterRespawn(ALICE));
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void dyingWhileJoiningRestoresAfterRespawning() {
      play.ok(new Join(ALICE, "Alice"));

      assertThat(play.ok(new Died(ALICE))).containsExactly(new RestoreAfterRespawn(ALICE));
      assertThat(play.game.isEmpty()).isTrue();
    }

    @Test
    void aSpectatorDyingIsRestoredAfterRespawning() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));

      assertThat(play.ok(new Died(DAVE))).containsExactly(new RestoreAfterRespawn(DAVE));
    }

    @Test
    void stoppingRestoresEveryoneAndResetsARunningArena() {
      play.ok(new Spectate(DAVE, "Dave"));
      play.ok(new SnapshotStored(DAVE));
      play.start(ALICE, BOB);
      play.tick(5, 0);
      play.ok(new Spectate(CAROL, "Carol"));

      var effects = play.ok(new Stop());

      assertThat(effects)
          .containsExactlyInAnyOrder(
              new Restore(DAVE),
              new RecordBestWave(ALICE, "Alice", 1),
              new Restore(ALICE),
              new RecordBestWave(BOB, "Bob", 1),
              new Restore(BOB),
              new Restore(CAROL),
              new ResetArena());
      assertThat(play.game.isEmpty()).isTrue();
      assertThat(play.ok(new SnapshotStored(CAROL))).containsExactly(new ForgetSnapshot(CAROL));
    }

    @Test
    void stoppingALobbyRestoresWithoutAReset() {
      play.arrive(ALICE, "knight");

      assertThat(play.ok(new Stop())).containsExactly(new Restore(ALICE));
    }

    @Test
    void anEmptyArenaStopsQuietly() {
      assertThat(play.ok(new Stop())).isEmpty();
    }

    @Test
    void aNewGameCanStartAfterTheLastOneEnds() {
      play.start(ALICE);
      play.tick(5, 0);
      play.ok(new Died(ALICE));

      play.start(BOB);

      assertThat(play.game.phase()).isInstanceOf(Intermission.class);
      assertThat(play.game.fighters()).extracting(Fighter::id).containsExactly(BOB);
    }
  }

  @Test
  void everyoneWhoArrivesIsRestoredExactlyOnce() {
    var restored = new ArrayList<UUID>();
    play.ok(new Spectate(DAVE, "Dave"));
    restored.addAll(restoredIn(play.ok(new SnapshotStored(DAVE))));
    play.arrive(ALICE, "knight");
    play.arrive(BOB, "knight");
    play.tick(1, 0);
    play.tick(10, 0);
    play.tick(5, 0);
    restored.addAll(restoredIn(play.ok(new Leave(BOB))));
    restored.addAll(restoredIn(play.ok(new Died(ALICE))));

    assertThat(restored).containsExactlyInAnyOrder(ALICE, BOB, DAVE);
  }

  private static List<UUID> restoredIn(List<GameEffect> effects) {
    return effects.stream()
        .<UUID>mapMulti(
            (effect, out) -> {
              if (effect instanceof Restore(var player)) {
                out.accept(player);
              } else if (effect instanceof RestoreAfterRespawn(var player)) {
                out.accept(player);
              }
            })
        .toList();
  }
}
