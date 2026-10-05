package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.shepherdjerred.thestorm.essentials.testing.PaperHarness.messages;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqBackStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import com.shepherdjerred.thestorm.essentials.testing.AllowAllProtection;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import com.shepherdjerred.thestorm.essentials.testing.PaperHarness;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class SharedTravelTest {
  @TempDir Path directory;
  PaperHarness harness;
  FakeWallets wallets;
  TeleportPayments payments;
  PaperRuntime runtime;
  TeleportFlow flow;
  PlayerMock alice;
  Instant firstSeen;

  @BeforeEach
  void start() throws Exception {
    wallets = new FakeWallets();
    harness = PaperHarness.start(directory, wallets);
    alice = harness.server.addPlayer("Alice");
    alice.setOp(false);
    wallets.deposit(new AccountId.Player(alice.getUniqueId()), 2000);
    messages(alice);
    var plugin = harness.server.getPluginManager().getPlugin("TheStorm");
    runtime =
        new PaperRuntime(
            harness.server, new PaperScheduler(plugin), harness.clock, plugin.getComponentLogger());
    var path = Path.of("../../../server/owned/plugins/TheStorm/essentials.yml");
    var config =
        StrictYaml.parse(path.toString(), Files.readString(path), EssentialsConfig.class)
            .fold(
                value -> value,
                error -> {
                  throw new AssertionError(error);
                });
    payments =
        new TeleportPayments(
            new TeleportPricer(config.teleports().pricing()),
            new TeleportPayments.Stores(
                new JooqTeleportUsageStore(harness.database),
                new JooqTeleportAttemptStore(harness.database)),
            wallets,
            harness.clock);
    firstSeen = harness.clock.instant().minus(Duration.ofDays(8));
    flow = build(CompletableFuture.completedFuture(null));
  }

  private TeleportFlow build(CompletableFuture<Void> recovery) {
    var shared =
        new TeleportFlow(
            runtime,
            new TeleportFlow.Services(
                payments,
                new GuardRegistry(),
                new AllowAllProtection(),
                new BackRecorder(runtime, new JooqBackStore(harness.database), 5, harness.sealed),
                harness.sealed),
            Duration.ofSeconds(3),
            (player, target) -> CompletableFuture.completedFuture(player.teleport(target)));
    shared.configureRtp(player -> CompletableFuture.completedFuture(firstSeen), recovery);
    return shared;
  }

  private TeleportFlow buildWithoutRtp() {
    return new TeleportFlow(
        runtime,
        new TeleportFlow.Services(
            payments,
            new GuardRegistry(),
            new AllowAllProtection(),
            new BackRecorder(runtime, new JooqBackStore(harness.database), 5, harness.sealed),
            harness.sealed),
        Duration.ofSeconds(3),
        (player, target) -> CompletableFuture.completedFuture(player.teleport(target)));
  }

  @AfterEach
  void close() {
    harness.close();
  }

  private Location landing() {
    return new Location(alice.getWorld(), 10.5, 5, 10.5);
  }

  private void rtp() {
    flow.travel(
        alice,
        TeleportKind.RTP,
        "wilderness",
        () ->
            CompletableFuture.completedFuture(
                Result.ok(new TeleportTravel.Landing(landing(), () -> {}, () -> {}))));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
  }

  @Test
  void rtpAndHomesShareBothHistoryAndCooldown() {
    rtp();
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(1975);
    flow.start(Ticket.self(alice, TeleportKind.HOME, Destination.fixed(landing(), "home")));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(1975);
    assertThat(messages(alice)).anyMatch(line -> line.contains("All travel commands share"));
    harness.clock.advance(Duration.ofMinutes(1));
    flow.start(Ticket.self(alice, TeleportKind.HOME, Destination.fixed(landing(), "home")));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    assertThat(payments.history(alice.getUniqueId()).join().trips()).hasSize(2);
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(1950);
  }

  @Test
  void sevenDayFreeRtpStillEscalatesAndExpiresExactlyAtTheBoundary() {
    firstSeen = harness.clock.instant();
    for (var i = 0; i < 5; i++) {
      rtp();
      if (i < 4) harness.clock.advance(Duration.ofMinutes(1));
    }
    var status = flow.status(alice).join();
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(2000);
    assertThat(status.history().trips()).hasSize(5);
    assertThat(Duration.between(harness.clock.instant(), status.history().cooldownUntil()))
        .isEqualTo(Duration.ofMinutes(2));
    harness.clock.advance(
        Duration.between(harness.clock.instant(), firstSeen.plus(Duration.ofDays(7))));
    assertThat(flow.status(alice).join().quote(TeleportKind.RTP).cost()).isEqualTo(25);
  }

  @Test
  void bothTpaDirectionsChargeAndCountOnlyTheRequester() {
    var bob = harness.server.addPlayer("Bob");
    bob.setOp(false);
    wallets.deposit(new AccountId.Player(bob.getUniqueId()), 500);
    bob.teleport(landing());
    flow.start(new Ticket(alice, alice, TeleportKind.TPA, Destination.player(bob)));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    assertThat(payments.history(alice.getUniqueId()).join().trips().getFirst().halfPoints())
        .isEqualTo(4);
    assertThat(payments.history(bob.getUniqueId()).join().trips()).isEmpty();
    harness.clock.advance(Duration.ofMinutes(1));
    flow.start(new Ticket(bob, alice, TeleportKind.TPA, Destination.player(alice)));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    assertThat(payments.history(alice.getUniqueId()).join().trips()).hasSize(2);
    assertThat(payments.history(bob.getUniqueId()).join().trips()).isEmpty();
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(1950);
    assertThat(wallets.balanceOf(new AccountId.Player(bob.getUniqueId()))).isEqualTo(500);
    assertThat(flow.status(alice).join().quote(TeleportKind.HOME).cost()).isEqualTo(50);
  }

  @Test
  void statusQueriesDoNotSpendOrRecordUsage() {
    var before = payments.history(alice.getUniqueId()).join();
    var status = flow.status(alice).join();
    assertThat(status.quote(TeleportKind.RTP).cost()).isEqualTo(25);
    assertThat(payments.history(alice.getUniqueId()).join()).isEqualTo(before);
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void statusWorksWhenTheQolModuleDidNotInstallRtp() {
    flow = buildWithoutRtp();

    var status = flow.status(alice).join();

    assertThat(status.quote(TeleportKind.RTP).cost()).isEqualTo(25);
    assertThat(status.rtpFreeUntil()).isEqualTo(Instant.EPOCH);
  }

  @Test
  void failedPreparationAndCancelledWarmupConsumeNothingAndReleaseResources() {
    flow.travel(
        alice,
        TeleportKind.RTP,
        "wilderness",
        () ->
            CompletableFuture.completedFuture(Result.err(Component.text("No safe destination."))));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    var released = new AtomicInteger();
    flow.travel(
        alice,
        TeleportKind.RTP,
        "wilderness",
        () ->
            CompletableFuture.completedFuture(
                Result.ok(
                    new TeleportTravel.Landing(landing(), released::incrementAndGet, () -> {}))));
    var seen = new ArrayList<String>();
    harness.until(
        () -> {
          seen.addAll(messages(alice));
          return seen.stream().anyMatch(line -> line.contains("Don't move."));
        });
    flow.damaged(alice);
    assertThat(flow.isBusy(alice.getUniqueId())).isFalse();
    assertThat(released.get()).isEqualTo(1);
    assertThat(payments.history(alice.getUniqueId()).join().trips()).isEmpty();
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void wildernessSearchReservationBlocksOtherCommandsAndLateResultsReleaseTheirChunk() {
    var pending = new CompletableFuture<Result<TeleportTravel.Landing, Component>>();
    var preparing = new AtomicInteger();
    flow.travel(
        alice,
        TeleportKind.RTP,
        "wilderness",
        () -> {
          preparing.incrementAndGet();
          return pending;
        });
    harness.until(() -> preparing.get() == 1);
    flow.start(Ticket.self(alice, TeleportKind.HOME, Destination.fixed(landing(), "home")));
    assertThat(messages(alice)).anyMatch(line -> line.contains("already under way"));
    flow.left(alice.getUniqueId());
    var released = new AtomicInteger();
    pending.complete(
        Result.ok(new TeleportTravel.Landing(landing(), released::incrementAndGet, () -> {})));
    harness.until(() -> released.get() == 1);
    assertThat(payments.history(alice.getUniqueId()).join().trips()).isEmpty();
  }

  @Test
  void legacyRefundFailureKeepsAllTravelUnavailable() {
    var gate = new CompletableFuture<Void>();
    flow = build(gate);
    flow.start(Ticket.self(alice, TeleportKind.HOME, Destination.fixed(landing(), "home")));
    assertThat(flow.isBusy(alice.getUniqueId())).isTrue();
    gate.completeExceptionally(new IllegalStateException("legacy refund unavailable"));
    harness.until(() -> !flow.isBusy(alice.getUniqueId()));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(payments.history(alice.getUniqueId()).join().trips()).isEmpty();
  }
}
