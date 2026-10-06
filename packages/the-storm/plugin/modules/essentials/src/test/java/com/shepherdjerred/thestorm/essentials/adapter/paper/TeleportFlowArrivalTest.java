package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.shepherdjerred.thestorm.essentials.testing.PaperHarness.messages;
import static java.util.concurrent.CompletableFuture.completedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqBackStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrice;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrices;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.testing.AllowAllProtection;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import com.shepherdjerred.thestorm.essentials.testing.PaperHarness;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Optional;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Exercises a successful arrival through the paid TPA flow without MockBukkit's missing move. */
final class TeleportFlowArrivalTest {

  @TempDir Path directory;
  @Nullable PaperHarness harness;

  @AfterEach
  void stop() {
    if (harness != null) {
      harness.close();
    }
  }

  @Test
  void acceptingPlayerHearsCompletionAfterPaidArrivalIsConfirmed() {
    var wallets = new FakeWallets();
    harness = PaperHarness.start(directory, wallets);
    var alice = harness.server.addPlayer("Alice");
    var bob = harness.server.addPlayer("Bob");
    wallets.deposit(new AccountId.Player(alice.getUniqueId()), 100);
    messages(alice);
    messages(bob);
    var plugin = harness.server.getPluginManager().getPlugin("TheStorm");
    var runtime =
        new PaperRuntime(
            harness.server, new PaperScheduler(plugin), harness.clock, plugin.getComponentLogger());
    var price = new TeleportPrice(25, Duration.ZERO, 1);
    var pricing =
        new TeleportPricing(
            new TeleportPrices(price, price, price, price, price, price),
            Duration.ofHours(1),
            4,
            32,
            Duration.ofDays(7));
    var payments =
        new TeleportPayments(
            new TeleportPricer(pricing),
            new TeleportPayments.Stores(
                new JooqTeleportUsageStore(harness.database),
                new JooqTeleportAttemptStore(harness.database)),
            wallets,
            harness.clock);
    var flow =
        new TeleportFlow(
            runtime,
            new TeleportFlow.Services(
                payments,
                new GuardRegistry(),
                new AllowAllProtection(),
                new BackRecorder(runtime, new JooqBackStore(harness.database), 5, harness.sealed),
                harness.sealed),
            Duration.ZERO,
            (player, destination) -> completedFuture(true));

    flow.start(
        new Ticket(alice, alice, TeleportKind.TPA, Destination.player(bob), Optional.of(bob)));

    var observed = new ArrayList<String>();
    harness.until(
        () -> {
          observed.addAll(messages(bob));
          return observed.stream().anyMatch(message -> message.contains("request completed"));
        });
    assertThat(observed).anyMatch(message -> message.contains("request completed"));
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(75);
    assertThat(flow.isBusy(alice.getUniqueId())).isFalse();
  }
}
