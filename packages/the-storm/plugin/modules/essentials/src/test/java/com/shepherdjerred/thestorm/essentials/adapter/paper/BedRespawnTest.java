package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.core.world.SpawnArrivals;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations;
import com.shepherdjerred.thestorm.essentials.app.StaffState;
import com.shepherdjerred.thestorm.essentials.app.StaffStore;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.store.BackStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.back.BackHistory;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrice;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrices;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import com.shepherdjerred.thestorm.essentials.testing.AllowAllProtection;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class BedRespawnTest {
  private ServerMock server;
  private PendingWorld world;
  private PlayerMock player;
  private TeleportListener listener;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new PendingWorld();
    server.addWorld(world);
    for (var y = world.getMinHeight(); y <= 90; y++) {
      world.getBlockAt(0, y, 0).setType(Material.LAVA);
    }
    world.getBlockAt(1, 63, 0).setType(Material.STONE);
    player = new MovingPlayer(server);
    server.addPlayer(player);
    var runtime =
        new PaperRuntime(
            server,
            new ImmediateScheduler(),
            InstantSource.fixed(Instant.parse("2026-10-27T12:00:00Z")),
            ComponentLogger.logger("bed-respawn-test"),
            ProductAnalytics.disabled());
    var beds = new BedHomes();
    beds.remember(player.getUniqueId(), new Position(world.getName(), 0.5, 64, 0.5, 0, 0));
    var sealed = new SealedWorlds();
    var back = new BackRecorder(runtime, new EmptyBack(), 5, sealed);
    listener =
        new TeleportListener(
            runtime,
            new TeleportFlow(
                runtime,
                new TeleportFlow.Services(
                    payments(runtime.time()),
                    new GuardRegistry(),
                    new AllowAllProtection(),
                    back,
                    sealed,
                    nowhere(),
                    new Position(world.getName(), 100, 200, 100, 0, 0)),
                Duration.ofSeconds(3)),
            new TeleportListener.Places(
                back,
                new SafeTracker(),
                new RuntimeDestinations(
                    new StaffState(new UnloadedStaff()),
                    new Position(world.getName(), 100, 200, 100, 0, 0)),
                beds));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void anUnloadedUnsafeBedMovesToTheAdjacentSafeColumn() {
    var event =
        new PlayerRespawnEvent(
            player,
            new Location(world, 50, 80, 50),
            false,
            false,
            false,
            PlayerRespawnEvent.RespawnReason.DEATH);
    listener.onRespawn(event);
    player.teleport(new Location(world, 0.5, 64, 0.5));

    world.pending.complete(world.getChunkAt(0, 0));

    assertThat(player.getLocation().getBlockX()).isEqualTo(1);
    assertThat(player.getLocation().getBlockY()).isEqualTo(64);
    assertThat(player.getLocation().getBlockZ()).isZero();
  }

  private static TeleportPayments payments(InstantSource time) {
    var price = new TeleportPrice(0, Duration.ZERO);
    return new TeleportPayments(
        new TeleportPricer(
            new TeleportPricing(
                new TeleportPrices(price, price, price, price, price, price), Duration.ofDays(7))),
        new TeleportPayments.Stores(new EmptyUsage(), new EmptyAttempts()),
        new FakeWallets(),
        time);
  }

  private static SpawnArrivals nowhere() {
    return new SpawnArrivals() {
      @Override
      public int radius() {
        return 32;
      }

      @Override
      public boolean contains(Location location) {
        return false;
      }
    };
  }

  private static final class ImmediateScheduler implements Scheduler {
    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      task.run();
      return () -> {};
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new UnsupportedOperationException();
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }

  private static final class UnloadedStaff implements StaffStore {
    @Override
    public CompletableFuture<List<Entry>> load() {
      return new CompletableFuture<>();
    }

    @Override
    public CompletableFuture<Void> write(List<Entry> entries, Audit audit) {
      return CompletableFuture.completedFuture(null);
    }
  }

  private static final class EmptyBack implements BackStore {
    @Override
    public CompletableFuture<Void> push(UUID player, BackEntry entry, int capacity) {
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<BackHistory> history(UUID player, int capacity) {
      return CompletableFuture.completedFuture(BackHistory.of(capacity, List.of()));
    }
  }

  private static final class EmptyUsage implements TeleportUsageStore {
    @Override
    public CompletableFuture<Optional<TeleportUsage>> find(UUID player) {
      return CompletableFuture.completedFuture(Optional.empty());
    }

    @Override
    public CompletableFuture<Void> confirm(Confirmation confirmation) {
      return CompletableFuture.completedFuture(null);
    }
  }

  private static final class EmptyAttempts implements TeleportAttemptStore {
    @Override
    public CompletableFuture<Void> insert(
        com.shepherdjerred.thestorm.essentials.app.TeleportAttempt attempt) {
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<List<com.shepherdjerred.thestorm.essentials.app.TeleportAttempt>>
        pending() {
      return CompletableFuture.completedFuture(List.of());
    }

    @Override
    public CompletableFuture<Void> delete(UUID id) {
      return CompletableFuture.completedFuture(null);
    }
  }

  private static final class MovingPlayer extends PlayerMock {
    MovingPlayer(ServerMock server) {
      super(server, "Alice");
    }

    @Override
    public CompletableFuture<Boolean> teleportAsync(
        Location location,
        PlayerTeleportEvent.TeleportCause cause,
        io.papermc.paper.entity.TeleportFlag... flags) {
      return CompletableFuture.completedFuture(teleport(location, cause));
    }
  }

  private static final class PendingWorld extends WorldMock {
    final CompletableFuture<Chunk> pending = new CompletableFuture<>();

    PendingWorld() {
      super(new WorldCreator("world"));
    }

    @Override
    public boolean isChunkLoaded(int x, int z) {
      return false;
    }

    @Override
    public CompletableFuture<Chunk> getChunkAtAsync(
        int x, int z, boolean generate, boolean urgent) {
      return pending;
    }
  }
}
