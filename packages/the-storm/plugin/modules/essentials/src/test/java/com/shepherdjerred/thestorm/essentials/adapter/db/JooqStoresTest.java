package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_BACK_HISTORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.TeleportAttempt;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore.KitClaim;
import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore.KnownPlayer;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore.Confirmation;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeError;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.kit.Kit;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitError;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitItem;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUse;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqStoresTest {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  @TempDir Path directory;
  StormDatabase database;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("essentials", JooqStoresTest.class.getClassLoader());
  }

  private void confirm(JooqTeleportUsageStore store, Confirmation confirmation) {
    store.confirm(confirmation).join();
  }

  @AfterEach
  void close() {
    database.close();
  }

  static Position at(double x) {
    return new Position("world", x, 64.5, -12.25, 90.5f, -30f);
  }

  static Home home(String name, double x) {
    return new Home(new PlaceName(name), at(x));
  }

  @Test
  void migratingTwiceIsHarmless() {
    database.migrate("essentials", JooqStoresTest.class.getClassLoader());
  }

  @Test
  void teleportChargeObligationsSurviveStoreRecreationUntilDeleted() {
    var id = UUID.fromString("00000000-0000-0000-0000-000000000042");
    var attempt = new TeleportAttempt(id, ALICE, TeleportKind.HOME, 25);
    var first = new JooqTeleportAttemptStore(database);

    first.insert(attempt).join();

    var reopened = new JooqTeleportAttemptStore(database);
    assertThat(reopened.pending().join()).containsExactly(attempt);
    reopened.delete(id).join();
    assertThat(first.pending().join()).isEmpty();
  }

  @Test
  void homesAreSetMovedListedAndDeletedPerPlayer() {
    var homes = new JooqHomeStore(database);

    assertThat(homes.set(ALICE, home("base", 1), 2).join())
        .isEqualTo(Result.ok(HomeRules.Change.CREATED));
    assertThat(homes.set(ALICE, home("farm", 2), 2).join())
        .isEqualTo(Result.ok(HomeRules.Change.CREATED));
    assertThat(homes.set(ALICE, home("mine", 3), 2).join())
        .isEqualTo(Result.err(new HomeError.LimitReached(2)));
    assertThat(homes.set(ALICE, home("base", 9), 2).join())
        .isEqualTo(Result.ok(HomeRules.Change.MOVED));
    assertThat(homes.set(BOB, home("base", 5), 1).join())
        .isEqualTo(Result.ok(HomeRules.Change.CREATED));

    assertThat(homes.homes(ALICE).join()).containsExactly(home("base", 9), home("farm", 2));
    assertThat(homes.delete(ALICE, new PlaceName("farm")).join()).isTrue();
    assertThat(homes.delete(ALICE, new PlaceName("farm")).join()).isFalse();
    assertThat(homes.homes(ALICE).join()).containsExactly(home("base", 9));
    assertThat(homes.homes(BOB).join()).containsExactly(home("base", 5));
  }

  @Test
  void warpsAreSavedMovedAndDeleted() {
    var warps = new JooqWarpStore(database);
    var arena = new Warp(new PlaceName("arena"), at(1));

    warps.save(arena).join();
    warps.save(new Warp(new PlaceName("arena"), at(2))).join();
    warps.save(new Warp(new PlaceName("mine"), at(3))).join();

    assertThat(warps.all().join())
        .containsExactly(
            new Warp(new PlaceName("arena"), at(2)), new Warp(new PlaceName("mine"), at(3)));
    assertThat(warps.delete(new PlaceName("arena")).join()).isTrue();
    assertThat(warps.delete(new PlaceName("arena")).join()).isFalse();
  }

  @Test
  void backHistoryKeepsTheNewestEntriesPerPlayer() {
    var back = new JooqBackStore(database);
    for (var i = 1; i <= 4; i++) {
      back.push(ALICE, new BackEntry(at(i), BackEntry.Cause.TELEPORT, T0.plusSeconds(i)), 3).join();
    }
    back.push(ALICE, new BackEntry(at(5), BackEntry.Cause.DEATH, T0.plusSeconds(5)), 3).join();
    back.push(BOB, new BackEntry(at(9), BackEntry.Cause.DEATH, T0), 3).join();

    var history = back.history(ALICE, 3).join();

    assertThat(history.entries())
        .containsExactly(
            new BackEntry(at(5), BackEntry.Cause.DEATH, T0.plusSeconds(5)),
            new BackEntry(at(4), BackEntry.Cause.TELEPORT, T0.plusSeconds(4)),
            new BackEntry(at(3), BackEntry.Cause.TELEPORT, T0.plusSeconds(3)));
    var rows = database.read(dsl -> dsl.fetchCount(ESSENTIALS_BACK_HISTORY)).join();
    assertThat(rows).isEqualTo(4);
    assertThat(back.history(BOB, 3).join().entries()).hasSize(1);
  }

  @Test
  void kitClaimsEnforceCooldownsAtomically() {
    var claims = new JooqKitClaimStore(database);
    var bread = new KitItem("BREAD", 1, Optional.empty(), Map.of());
    var daily = new Kit(List.of(bread), List.of(), Duration.ofDays(1), false);
    var starter = new Kit(List.of(bread), List.of(), Duration.ZERO, true);

    assertThat(claims.claim(ALICE, new KitClaim("daily", daily, T0)).join())
        .isEqualTo(Result.ok(T0));
    assertThat(claims.claim(ALICE, new KitClaim("daily", daily, T0.plusSeconds(60))).join())
        .isEqualTo(Result.err(new KitError.OnCooldown(Duration.ofDays(1).minusSeconds(60))));
    var tomorrow = T0.plus(Duration.ofDays(1));
    assertThat(claims.claim(ALICE, new KitClaim("daily", daily, tomorrow)).join())
        .isEqualTo(Result.ok(tomorrow));
    assertThat(claims.claim(ALICE, new KitClaim("daily", daily, tomorrow.plusSeconds(1))).join())
        .isEqualTo(Result.err(new KitError.OnCooldown(Duration.ofDays(1).minusSeconds(1))));

    assertThat(claims.claim(ALICE, new KitClaim("starter", starter, T0)).join())
        .isEqualTo(Result.ok(T0));
    assertThat(claims.claim(ALICE, new KitClaim("starter", starter, tomorrow)).join())
        .isEqualTo(Result.err(new KitError.AlreadyClaimed()));
    assertThat(claims.claim(BOB, new KitClaim("starter", starter, tomorrow)).join())
        .isEqualTo(Result.ok(tomorrow));
  }

  @Test
  void zeroCooldownClaimsInTheSameMillisecondHaveDistinctDeliveryMarkers() {
    var claims = new JooqKitClaimStore(database);
    var bread = new KitItem("BREAD", 1, Optional.empty(), Map.of());
    var reusable = new Kit(List.of(bread), List.of(), Duration.ZERO, false);

    assertThat(claims.claim(ALICE, new KitClaim("bread", reusable, T0)).join())
        .isEqualTo(Result.ok(T0));
    assertThat(claims.claim(ALICE, new KitClaim("bread", reusable, T0)).join())
        .isEqualTo(Result.ok(T0));
    assertThat(claims.pending(ALICE).join())
        .extracting(pending -> pending.claimedAt().toEpochMilli())
        .containsExactly(T0.toEpochMilli(), T0.toEpochMilli() + 1);
  }

  @Test
  void firstJoinRecordsStarterClaimAndDeliveryInTheSameTransaction() {
    var players = new JooqPlayerStore(database);
    var kits = new JooqKitClaimStore(database);

    assertThat(
            players.recordJoin(new KnownPlayer(ALICE, "Alice", T0), Optional.of("starter")).join())
        .isTrue();
    assertThat(kits.pending(ALICE).join())
        .containsExactly(
            new com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore.PendingKit(
                "starter", T0));
    assertThat(
            players
                .recordJoin(
                    new KnownPlayer(ALICE, "Alice", T0.plusSeconds(1)), Optional.of("starter"))
                .join())
        .isFalse();
    assertThat(kits.pending(ALICE).join()).hasSize(1);
    assertThat(players.recordJoin(new KnownPlayer(BOB, "Bob", T0), Optional.empty()).join())
        .isTrue();
    assertThat(kits.pending(BOB).join()).isEmpty();
  }

  @Test
  void teleportHistoryIsSharedDurableAndConfirmedExactlyOnce() {
    var store = new JooqTeleportUsageStore(database);
    var cutoff = T0.minus(Duration.ofHours(1));
    var first = new TeleportUsage(List.of(new TeleportUse(T0, 2)), T0.plusSeconds(60));
    var second =
        new TeleportUsage(
            List.of(new TeleportUse(T0, 2), new TeleportUse(T0.plusSeconds(90), 1)),
            T0.plusSeconds(210));
    var operation = UUID.randomUUID();
    var attempts = new JooqTeleportAttemptStore(database);
    attempts.insert(new TeleportAttempt(operation, ALICE, TeleportKind.WARP, 15)).join();

    assertThat(store.find(ALICE, cutoff).join()).isEmpty();
    confirm(store, new Confirmation(ALICE, UUID.randomUUID(), TeleportKind.HOME, first, cutoff));
    assertThat(store.find(ALICE, cutoff).join()).contains(first);
    confirm(store, new Confirmation(ALICE, operation, TeleportKind.WARP, second, cutoff));
    confirm(store, new Confirmation(ALICE, operation, TeleportKind.WARP, second, cutoff));
    assertThat(store.find(ALICE, cutoff).join()).contains(second);
    assertThat(attempts.pending().join()).isEmpty();
    assertThat(store.find(BOB, cutoff).join()).isEmpty();

    database.close();
    database = StormDatabase.open(directory.resolve("t.db"));
    var reopened = new JooqTeleportUsageStore(database);
    assertThat(reopened.find(ALICE, cutoff).join()).contains(second);
    assertThat(reopened.find(ALICE, T0.plusSeconds(90)).join())
        .contains(new TeleportUsage(List.of(), second.cooldownUntil()));
  }

  @Test
  void lateConfirmationCannotShortenAnotherTripCooldownOrChangeItsPayer() {
    var store = new JooqTeleportUsageStore(database);
    var operation = UUID.randomUUID();
    var longer = new TeleportUsage(List.of(new TeleportUse(T0, 2)), T0.plusSeconds(120));
    var shorter =
        new TeleportUsage(List.of(new TeleportUse(T0.plusSeconds(1), 1)), T0.plusSeconds(31));
    confirm(
        store, new Confirmation(ALICE, operation, TeleportKind.HOME, longer, T0.minusSeconds(1)));
    confirm(
        store,
        new Confirmation(ALICE, UUID.randomUUID(), TeleportKind.WARP, shorter, T0.minusSeconds(1)));
    assertThat(store.find(ALICE, T0.minusSeconds(1)).join())
        .contains(
            new TeleportUsage(
                List.of(new TeleportUse(T0, 2), new TeleportUse(T0.plusSeconds(1), 1)),
                longer.cooldownUntil()));
    assertThatThrownBy(
            () ->
                confirm(
                    store,
                    new Confirmation(
                        BOB, operation, TeleportKind.HOME, longer, T0.minusSeconds(1))))
        .hasRootCauseInstanceOf(IllegalStateException.class);
    assertThat(store.find(BOB, T0.minusSeconds(1)).join()).isEmpty();
  }

  @Test
  void confirmingTripPrunesExpiredUsageInTheSameWrite() {
    var store = new JooqTeleportUsageStore(database);
    var retentionCutoff = T0.minus(Duration.ofHours(1));
    var expired =
        new TeleportUsage(
            List.of(new TeleportUse(T0.minus(Duration.ofHours(2)), 4)), T0.minusSeconds(1));
    var current = new TeleportUse(T0, 2);
    var usage = new TeleportUsage(List.of(current), T0.plusSeconds(60));

    confirm(
        store,
        new Confirmation(ALICE, UUID.randomUUID(), TeleportKind.HOME, expired, retentionCutoff));
    confirm(
        store,
        new Confirmation(ALICE, UUID.randomUUID(), TeleportKind.HOME, usage, retentionCutoff));

    assertThat(store.find(ALICE, retentionCutoff).join())
        .contains(new TeleportUsage(List.of(current), T0.plusSeconds(60)));
  }

  @Test
  void theModerationLogIsAppendOnlyAndOrdered() {
    var log = new JooqModerationLogStore(database);
    var staff = Actor.player(BOB, "RiotShielder");
    var kick =
        AuditEntry.of(ALICE, ModerationAction.KICK, staff, AuditEntry.Term.permanent("spam", T0));
    var tempban =
        AuditEntry.of(
            ALICE,
            ModerationAction.BAN,
            Actor.CONSOLE,
            new AuditEntry.Term(Optional.of(Duration.ofDays(3)), "griefing", T0.plusSeconds(1)));
    var other =
        AuditEntry.of(
            BOB, ModerationAction.KICK, Actor.CONSOLE, AuditEntry.Term.permanent("afk", T0));

    log.append(kick).join();
    log.append(tempban).join();
    log.append(other).join();

    assertThat(log.all().join()).containsExactly(kick, tempban, other);
    assertThat(log.history(ALICE, 10).join()).containsExactly(tempban, kick);
    assertThat(log.history(ALICE, 1).join()).containsExactly(tempban);
  }

  @Test
  void playersAreNewOnlyOnTheirFirstJoinAndKeepTheirLatestName() {
    var players = new JooqPlayerStore(database);

    assertThat(players.recordJoin(new KnownPlayer(ALICE, "Alice", T0), Optional.empty()).join())
        .isTrue();
    assertThat(
            players
                .recordJoin(new KnownPlayer(ALICE, "Alyce", T0.plusSeconds(60)), Optional.empty())
                .join())
        .isFalse();
    assertThat(players.recordJoin(new KnownPlayer(BOB, "Bob", T0), Optional.empty()).join())
        .isTrue();

    assertThat(players.all().join())
        .containsExactlyInAnyOrder(
            new KnownPlayer(ALICE, "Alyce", T0.plusSeconds(60)), new KnownPlayer(BOB, "Bob", T0));
  }
}
