package com.shepherdjerred.thestorm.skytravel.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.qol.app.CombatStatus;
import com.shepherdjerred.thestorm.skytravel.app.FlightChecks;
import com.shepherdjerred.thestorm.skytravel.app.FlightStore;
import com.shepherdjerred.thestorm.skytravel.domain.FlightLease;
import com.shepherdjerred.thestorm.skytravel.domain.LaunchConfig;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.random.RandomGenerator;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class LaunchFlightsTest {
  @TempDir Path directory;
  private ServerMock server;
  private WorldMock world;
  private PlayerMock alice;
  private StormDatabase database;
  private LaunchFlights flights;
  private final MemoryStore store = new MemoryStore();
  private final ManualMain main = new ManualMain();
  private final Set<UUID> tagged = new HashSet<>();
  private Instant now = Instant.parse("2026-11-07T12:00:00Z");
  private CompletableFuture<Boolean> flag = CompletableFuture.completedFuture(true);

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("skylands");
    world.getBlockAt(0, 87, 0).setType(Material.SEA_LANTERN);
    world.getBlockAt(2, 89, 0).setType(Material.STONE_BUTTON);
    var plugin = MockBukkit.createMockPlugin();
    database = StormDatabase.open(directory.resolve("unused.db"));
    var services = new Services();
    services.provide(
        CombatStatus.class,
        id -> tagged.contains(id) ? Optional.of(Duration.ofSeconds(10)) : Optional.empty());
    services.provide(ManagedGameplay.class, new ManagedGameplay((key, id) -> flag, () -> {}));
    var context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            main,
            new DirectComputePool(),
            database,
            services,
            directory,
            () -> now,
            RandomGenerator.getDefault(),
            plugin.getComponentLogger(),
            ProductAnalytics.disabled());
    var tower =
        new LaunchConfig.Tower(
            "H",
            true,
            new LaunchConfig.Block(0, 64, 0),
            new LaunchConfig.Block(0, 88, 0),
            new LaunchConfig.Block(2, 89, 0),
            List.of(new LaunchConfig.Block(0, 64, -12)));
    flights =
        new LaunchFlights(
            context,
            new LaunchConfig("skylands", 480, 120, 30, 2, 15, List.of(tower)),
            store,
            FlightChecks.absent());
    flights.start();
    main.settle();
    alice = server.addPlayer("Alice");
    alice.setGameMode(GameMode.SURVIVAL);
    alice.teleport(new Location(world, 0.5, 88, 0.5));
  }

  @AfterEach
  void stop() {
    flights.stop();
    MockBukkit.unmock();
    database.close();
  }

  @Test
  void aButtonDoesNotLaunchBystandersOrSwapEquipment() {
    var bob = server.addPlayer("Bob");
    bob.teleport(new Location(world, 0.5, 88, 0.5));
    var chest = ItemStack.of(Material.DIAMOND_CHESTPLATE);
    alice.getInventory().setChestplate(chest);
    click(alice, EquipmentSlot.HAND);
    advance(1);
    assertThat(store.writes).isEmpty();
    advance(1);
    assertThat(store.writes).hasSize(1);
    assertThat(store.writes.getFirst().player()).isEqualTo(alice.getUniqueId());
    assertThat(alice.getInventory().getChestplate()).isEqualTo(chest);
    assertThat(alice.getAllowFlight()).isFalse();
    assertThat(bob.getVelocity().lengthSquared()).isZero();
    assertThat(alice.getVelocity().getY()).isPositive();
  }

  @Test
  void carryingAPassengerPreventsLaunch() {
    var chicken = world.spawn(alice.getLocation(), org.bukkit.entity.Chicken.class);
    assertThat(alice.addPassenger(chicken)).isTrue();
    click(alice, EquipmentSlot.HAND);
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  @Test
  void ridingAVehiclePreventsLaunch() {
    var boat = world.spawn(alice.getLocation(), org.bukkit.entity.Boat.class);
    assertThat(boat.addPassenger(alice)).isTrue();
    click(alice, EquipmentSlot.HAND);
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  @Test
  void disabledLaunchesAndDuplicateOffHandEventsNeverCreateLeases() {
    flag = CompletableFuture.completedFuture(false);
    click(alice, EquipmentSlot.HAND);
    click(alice, EquipmentSlot.OFF_HAND);
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  @Test
  void combatBeforeOrDuringTheCountdownRefusesLaunch() {
    tagged.add(alice.getUniqueId());
    click(alice, EquipmentSlot.HAND);
    advance(3);
    assertThat(store.writes).isEmpty();
    tagged.clear();
    click(alice, EquipmentSlot.HAND);
    tagged.add(alice.getUniqueId());
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  @Test
  void steppingOffCancelsEvenIfTheFlagResponseArrivesAfterwards() {
    flag = new CompletableFuture<>();
    click(alice, EquipmentSlot.HAND);
    flights.move(new PlayerMoveEvent(alice, alice.getLocation(), new Location(world, 5, 88, 0)));
    flag.complete(true);
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  @Test
  void leaseMustBeDurableBeforeAnyVelocityIsGranted() {
    store.saved = new CompletableFuture<>();
    click(alice, EquipmentSlot.HAND);
    advance(2);
    assertThat(store.writes).hasSize(1);
    assertThat(alice.getVelocity().lengthSquared()).isZero();
    click(alice, EquipmentSlot.HAND);
    assertThat(store.writes).hasSize(1);
    store.saved.complete(null);
    main.settle();
    assertThat(alice.getVelocity().getY()).isPositive();
  }

  @Test
  void failedDurableWriteLeavesThePlayerOnThePad() {
    store.saved = CompletableFuture.failedFuture(new IllegalStateException("disk unavailable"));
    click(alice, EquipmentSlot.HAND);
    advance(2);
    assertThat(alice.getVelocity().lengthSquared()).isZero();
  }

  @Test
  void onlyActiveAssistanceExemptsTheVanillaFloatingKick() {
    var ordinary = kick(PlayerKickEvent.Cause.FLYING_PLAYER);
    flights.vanillaFlight(ordinary);
    assertThat(ordinary.isCancelled()).isFalse();
    click(alice, EquipmentSlot.HAND);
    advance(2);
    var assisted = kick(PlayerKickEvent.Cause.FLYING_PLAYER);
    flights.vanillaFlight(assisted);
    assertThat(assisted.isCancelled()).isTrue();
    var moderation = kick(PlayerKickEvent.Cause.BANNED);
    flights.vanillaFlight(moderation);
    assertThat(moderation.isCancelled()).isFalse();
    now = now.plusSeconds(120);
    var expired = kick(PlayerKickEvent.Cause.FLYING_PLAYER);
    flights.vanillaFlight(expired);
    assertThat(expired.isCancelled()).isFalse();
    assertThat(alice.getAllowFlight()).isFalse();
  }

  private PlayerKickEvent kick(PlayerKickEvent.Cause cause) {
    return new PlayerKickEvent(
        alice,
        net.kyori.adventure.text.Component.empty(),
        net.kyori.adventure.text.Component.empty(),
        cause);
  }

  @Test
  void providerFailureRefusesNewLaunches() {
    flag = CompletableFuture.failedFuture(new IllegalStateException("invalid response"));
    click(alice, EquipmentSlot.HAND);
    advance(3);
    assertThat(store.writes).isEmpty();
  }

  private void advance(int seconds) {
    now = now.plusSeconds(seconds);
    main.tick.run();
    main.settle();
  }

  private void click(PlayerMock player, EquipmentSlot hand) {
    flights.button(
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            ItemStack.empty(),
            world.getBlockAt(2, 89, 0),
            BlockFace.WEST,
            hand));
    main.settle();
  }

  private static final class MemoryStore implements FlightStore {
    final List<FlightLease> writes = new ArrayList<>();
    CompletableFuture<Void> saved = CompletableFuture.completedFuture(null);

    @Override
    public CompletableFuture<List<FlightLease>> load() {
      return CompletableFuture.completedFuture(List.of());
    }

    @Override
    public CompletableFuture<Void> save(FlightLease lease) {
      writes.add(lease);
      return saved;
    }

    @Override
    public CompletableFuture<Void> reset(UUID player) {
      return CompletableFuture.completedFuture(null);
    }
  }

  private static final class ManualMain implements Scheduler {
    Runnable tick = () -> {};
    private final ArrayDeque<Runnable> callbacks = new ArrayDeque<>();

    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      throw new AssertionError("Unexpected delayed task");
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      tick = task;
      return () -> tick = () -> {};
    }

    @Override
    public Executor mainThread() {
      return callbacks::add;
    }

    void settle() {
      for (var next = callbacks.poll(); next != null; next = callbacks.poll()) next.run();
    }
  }
}
