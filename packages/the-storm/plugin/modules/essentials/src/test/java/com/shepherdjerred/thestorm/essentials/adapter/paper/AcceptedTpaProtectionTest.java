package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.shepherdjerred.thestorm.essentials.testing.PaperHarness.messages;
import static java.util.concurrent.CompletableFuture.completedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.players.VisitPasses;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
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
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import com.shepherdjerred.thestorm.essentials.testing.PaperHarness;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * An accepted {@code /tpa} lands on claimed land. A home to the same place is still refused, and
 * the visit pass is armed when the move starts.
 */
final class AcceptedTpaProtectionTest {

  @TempDir Path directory;
  @Nullable PaperHarness harness;

  @AfterEach
  void stop() {
    if (harness != null) {
      harness.close();
    }
  }

  @Test
  void anAcceptedTpaLandsWhereAHomeIsRefused() {
    var wallets = new FakeWallets();
    harness = PaperHarness.start(directory, wallets);
    var alice = harness.server.addPlayer("Alice");
    var bob = harness.server.addPlayer("Bob");
    wallets.deposit(new AccountId.Player(alice.getUniqueId()), 100);
    messages(alice);
    var plugin = harness.server.getPluginManager().getPlugin("TheStorm");
    var runtime =
        new PaperRuntime(
            harness.server,
            new PaperScheduler(plugin),
            harness.clock,
            plugin.getComponentLogger(),
            com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.disabled());
    var price = new TeleportPrice(25, Duration.ZERO);
    var pricing =
        new TeleportPricing(
            new TeleportPrices(price, price, price, price, price, price), Duration.ofDays(7));
    var payments =
        new TeleportPayments(
            new TeleportPricer(pricing),
            new TeleportPayments.Stores(
                new JooqTeleportUsageStore(harness.database),
                new JooqTeleportAttemptStore(harness.database)),
            wallets,
            harness.clock);
    var visits = new VisitPasses();
    var armed = new AtomicBoolean();
    var moved = new AtomicInteger();
    var flow =
        new TeleportFlow(
            runtime,
            new TeleportFlow.Services(
                payments,
                new GuardRegistry(),
                closedLand(),
                new BackRecorder(runtime, new JooqBackStore(harness.database), 5, harness.sealed),
                harness.sealed,
                nowhere(),
                new com.shepherdjerred.thestorm.essentials.domain.place.Position(
                    "unused", 0, 64, 0, 0, 0),
                visits),
            Duration.ZERO,
            (player, destination) -> {
              armed.set(visits.consumePluginTeleport(player.getUniqueId()));
              moved.incrementAndGet();
              return completedFuture(true);
            });

    flow.start(Ticket.self(alice, TeleportKind.HOME, Destination.fixed(bob.getLocation(), "home")));

    assertThat(messages(alice)).anyMatch(message -> message.contains("this land is closed"));
    assertThat(moved).hasValue(0);
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(100);
    assertThat(visits.consumePluginTeleport(alice.getUniqueId())).isFalse();

    flow.start(
        new Ticket(alice, alice, TeleportKind.TPA, Destination.player(bob), Optional.of(bob)));
    harness.until(() -> moved.get() == 1);

    assertThat(armed).isTrue();
    assertThat(moved).hasValue(1);
    assertThat(visits.consumePluginTeleport(alice.getUniqueId())).isFalse();
    assertThat(wallets.balanceOf(new AccountId.Player(alice.getUniqueId()))).isEqualTo(75);
  }

  private static Protection closedLand() {
    return new Protection() {
      @Override
      public Decision check(UUID player, ProtectedAction action, Location location) {
        if (action == ProtectedAction.TELEPORT_INTO) {
          return new Decision.Denied(Component.text("this land is closed."));
        }
        return Decision.allowed();
      }

      @Override
      public Decision checkHarm(
          UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
        return Decision.allowed();
      }

      @Override
      public boolean sameLand(Location a, Location b) {
        return true;
      }

      @Override
      public boolean isPreserved(Location location) {
        return false;
      }
    };
  }

  private static com.shepherdjerred.thestorm.core.world.SpawnArrivals nowhere() {
    return new com.shepherdjerred.thestorm.core.world.SpawnArrivals() {
      @Override
      public int radius() {
        return 32;
      }

      @Override
      public boolean contains(org.bukkit.Location location) {
        return false;
      }
    };
  }
}
