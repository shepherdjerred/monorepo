package com.shepherdjerred.thestorm.essentials.app;

import static java.util.concurrent.CompletableFuture.completedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.store.ModerationLogStore;
import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore;
import com.shepherdjerred.thestorm.essentials.app.store.WarpStore;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import com.shepherdjerred.thestorm.essentials.testing.FakeClock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class AppServicesTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  final FakeClock clock = FakeClock.at("2026-09-25T12:00:00Z");

  static final class MemoryLog implements ModerationLogStore {
    final List<AuditEntry> entries = new ArrayList<>();

    @Override
    public CompletableFuture<Void> append(AuditEntry entry) {
      entries.add(entry);
      return completedFuture(null);
    }

    @Override
    public CompletableFuture<List<AuditEntry>> all() {
      return completedFuture(List.copyOf(entries));
    }

    @Override
    public CompletableFuture<List<AuditEntry>> history(UUID target, int limit) {
      return completedFuture(
          entries.reversed().stream().filter(e -> e.target().equals(target)).limit(limit).toList());
    }
  }

  AuditEntry ban(UUID target, Optional<Duration> length) {
    return AuditEntry.of(
        target,
        ModerationAction.BAN,
        Actor.CONSOLE,
        new AuditEntry.Term(length, "griefing", clock.instant()));
  }

  @Test
  void moderationReplaysTheLogAtStartup() {
    var log = new MemoryLog();
    log.entries.add(ban(ALICE, Optional.empty()));
    log.entries.add(ban(BOB, Optional.empty()));
    log.entries.add(
        AuditEntry.of(
            BOB,
            ModerationAction.UNBAN,
            Actor.CONSOLE,
            AuditEntry.Term.permanent("appeal", clock.instant())));

    var moderation = ModerationService.load(log, clock);

    assertThat(moderation.activeBan(ALICE).join()).isPresent();
    assertThat(moderation.activeBan(BOB).join()).isEmpty();
  }

  @Test
  void recordingABanAppliesAtOnceAndIsLogged() {
    var log = new MemoryLog();
    var moderation = ModerationService.load(log, clock);

    moderation.record(ban(ALICE, Optional.of(Duration.ofHours(1)))).join();

    assertThat(moderation.activeBan(ALICE).join()).isPresent();
    assertThat(log.entries).hasSize(1);
    clock.advance(Duration.ofHours(1));
    assertThat(moderation.activeBan(ALICE).join()).isEmpty();
  }

  @Test
  void historyIsNewestFirst() {
    var log = new MemoryLog();
    var moderation = ModerationService.load(log, clock);
    moderation
        .record(
            AuditEntry.of(
                ALICE,
                ModerationAction.KICK,
                Actor.CONSOLE,
                AuditEntry.Term.permanent("spam", clock.instant())))
        .join();
    moderation.record(ban(ALICE, Optional.empty())).join();

    assertThat(moderation.history(ALICE, 10).join())
        .extracting(AuditEntry::action)
        .containsExactly(ModerationAction.BAN, ModerationAction.KICK);
  }

  @Test
  void thePlayerDirectoryFindsNamesIgnoringCaseAndFollowsRenames() {
    var saved = new ArrayList<PlayerStore.KnownPlayer>();
    var store =
        new PlayerStore() {
          @Override
          public CompletableFuture<Boolean> recordJoin(KnownPlayer player) {
            var first = saved.stream().noneMatch(p -> p.uuid().equals(player.uuid()));
            saved.add(player);
            return completedFuture(first);
          }

          @Override
          public CompletableFuture<List<KnownPlayer>> all() {
            return completedFuture(List.of(new KnownPlayer(ALICE, "Alice", Instant.EPOCH)));
          }
        };
    var directory = PlayerDirectory.load(store);

    assertThat(directory.find("alice").map(PlayerStore.KnownPlayer::uuid)).contains(ALICE);
    assertThat(
            directory.joined(new PlayerStore.KnownPlayer(ALICE, "Alyce", clock.instant())).join())
        .isTrue();
    assertThat(directory.find("Alice")).isEmpty();
    assertThat(directory.find("ALYCE").map(PlayerStore.KnownPlayer::uuid)).contains(ALICE);
    assertThat(directory.name(ALICE)).contains("Alyce");
    assertThat(directory.names()).containsExactly("Alyce");
  }

  @Test
  void theNewestHolderOfANameWins() {
    var store =
        new PlayerStore() {
          @Override
          public CompletableFuture<Boolean> recordJoin(KnownPlayer player) {
            return completedFuture(false);
          }

          @Override
          public CompletableFuture<List<KnownPlayer>> all() {
            return completedFuture(
                List.of(
                    new KnownPlayer(BOB, "Steve", Instant.EPOCH.plusSeconds(10)),
                    new KnownPlayer(ALICE, "Steve", Instant.EPOCH)));
          }
        };

    assertThat(PlayerDirectory.load(store).find("steve").map(PlayerStore.KnownPlayer::uuid))
        .contains(BOB);
  }

  @Test
  void warpsAreCachedAndWrittenThrough() {
    var stored = new HashMap<PlaceName, Warp>();
    var store =
        new WarpStore() {
          @Override
          public CompletableFuture<List<Warp>> all() {
            return completedFuture(List.of(warp("mine")));
          }

          @Override
          public CompletableFuture<Void> save(Warp warp) {
            stored.put(warp.name(), warp);
            return completedFuture(null);
          }

          @Override
          public CompletableFuture<Boolean> delete(PlaceName name) {
            return completedFuture(stored.remove(name) != null);
          }
        };
    var warps = WarpDirectory.load(store);

    warps.set(warp("arena")).join();

    assertThat(warps.names()).containsExactly(new PlaceName("arena"), new PlaceName("mine"));
    assertThat(stored).containsKey(new PlaceName("arena"));
    assertThat(warps.delete(new PlaceName("arena")).join()).isTrue();
    assertThat(warps.find(new PlaceName("arena"))).isEmpty();
    assertThat(warps.find(new PlaceName("mine"))).isPresent();
  }

  static Warp warp(String name) {
    return new Warp(new PlaceName(name), new Position("world", 0, 64, 0, 0, 0));
  }

  @Test
  void afkTrackingFollowsActivityAndTimeouts() {
    var afk = new AfkTracker(clock, Duration.ofMinutes(5));
    afk.joined(ALICE);
    afk.joined(BOB);

    clock.advance(Duration.ofMinutes(4));
    afk.active(BOB);
    clock.advance(Duration.ofMinutes(1));

    assertThat(afk.sweep()).containsExactly(ALICE);
    assertThat(afk.sweep()).isEmpty();
    assertThat(afk.isAfk(ALICE)).isTrue();
    assertThat(afk.isAfk(BOB)).isFalse();
    assertThat(afk.active(ALICE)).isTrue();
    assertThat(afk.active(ALICE)).isFalse();
  }

  @Test
  void afkToggleAndLeaving() {
    var afk = new AfkTracker(clock, Duration.ofMinutes(5));
    afk.joined(ALICE);

    assertThat(afk.toggle(ALICE)).isTrue();
    assertThat(afk.isAfk(ALICE)).isTrue();
    afk.left(ALICE);
    assertThat(afk.isAfk(ALICE)).isFalse();
    assertThat(afk.active(ALICE)).isFalse();
  }

  @Test
  void guardsRefuseWithTheFirstReason() {
    var guards = new GuardRegistry();
    assertThat(guards.check(ALICE)).isEmpty();

    guards.add(player -> Optional.empty());
    guards.add(
        player -> player.equals(ALICE) ? Optional.of("You are in combat.") : Optional.empty());
    guards.add(player -> Optional.of("never reached for Alice"));

    assertThat(guards.check(ALICE)).contains("You are in combat.");
    assertThat(guards.check(BOB)).contains("never reached for Alice");
  }

  @Test
  void theTpaDeskSendsTakesAndExpires() {
    var desk = new TpaDesk(clock, Duration.ofMinutes(1));

    assertThat(desk.send(ALICE, ALICE, TpaRequest.Direction.TO_TARGET))
        .isEqualTo(Result.err(new TpaError.SelfRequest()));
    var sent = desk.send(ALICE, BOB, TpaRequest.Direction.TO_REQUESTER);
    assertThat(sent.map(TpaRequest::mover)).isEqualTo(Result.ok(BOB));
    assertThat(desk.take(BOB, Optional.empty()).map(TpaRequest::requester))
        .isEqualTo(Result.ok(ALICE));
    assertThat(desk.take(BOB, Optional.empty()))
        .isEqualTo(Result.err(new TpaError.NoPendingRequest()));

    desk.send(ALICE, BOB, TpaRequest.Direction.TO_TARGET);
    clock.advance(Duration.ofMinutes(1));
    assertThat(desk.expire()).extracting(TpaRequest::requester).containsExactly(ALICE);
    assertThat(desk.expire()).isEmpty();

    desk.send(ALICE, BOB, TpaRequest.Direction.TO_TARGET);
    desk.forget(BOB);
    assertThat(desk.take(BOB, Optional.of(ALICE)))
        .isEqualTo(Result.err(new TpaError.NoRequestFrom(ALICE)));
  }

  @Test
  void loadedFuturesComplete() {
    Map<String, CompletableFuture<Void>> loads =
        Map.of(
            "moderation", ModerationService.load(new MemoryLog(), clock).loaded(),
            "warps",
                WarpDirectory.load(
                        new WarpStore() {
                          @Override
                          public CompletableFuture<List<Warp>> all() {
                            return completedFuture(List.of());
                          }

                          @Override
                          public CompletableFuture<Void> save(Warp warp) {
                            return completedFuture(null);
                          }

                          @Override
                          public CompletableFuture<Boolean> delete(PlaceName name) {
                            return completedFuture(false);
                          }
                        })
                    .loaded());
    loads.values().forEach(future -> assertThat(future).isCompleted());
  }
}
