package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.AuditedBlockChanges;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuard;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqGraveStore;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.testing.FakeClock;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * Qol on a MockBukkit server: the shipped qol.yml, a temp SQLite database, a hand-moved clock,
 * plain grave heads (MockBukkit cannot resolve profiles), and fakes for essentials' ports and land
 * protection.
 */
final class QolHarness implements AutoCloseable {

  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/qol.yml");

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the harness, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  /** Collects the guards qol adds. */
  static final class Guards implements TeleportGuards {
    final List<TeleportGuard> added = new CopyOnWriteArrayList<>();

    @Override
    public void add(TeleportGuard guard) {
      added.add(guard);
    }

    Optional<Component> refusal(UUID mover, Location destination) {
      return added.stream()
          .map(guard -> guard.refusal(mover, destination))
          .flatMap(Optional::stream)
          .findFirst();
    }
  }

  /** Players the test marks away. */
  static final class Afk implements AfkStatus {
    final Set<UUID> away = new HashSet<>();

    @Override
    public boolean isAfk(UUID player) {
      return away.contains(player);
    }
  }

  /** Allows everything except where the test says building or opening containers is denied. */
  static final class Land implements Protection {
    Predicate<Location> noContainers = location -> false;
    Predicate<Location> noBuilding = location -> false;
    Predicate<Location> preserved = location -> false;

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      var denied =
          switch (action) {
            case OPEN_CONTAINER -> noContainers.test(location);
            case BUILD, AUTOMATIC_BUILD -> noBuilding.test(location);
            default -> false;
          };
      return denied
          ? new Decision.Denied(Component.text("This land belongs to Aegis."))
          : Decision.allowed();
    }

    @Override
    public Decision checkHarm(
        UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
      return Decision.allowed();
    }

    @Override
    public boolean isPreserved(Location location) {
      return preserved.test(location);
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return true;
    }
  }

  final ServerMock server;
  final WorldMock world;
  final StormDatabase database;
  final FakeClock clock = FakeClock.at("2026-09-25T12:00:00Z");

  /** Worlds the test seals; graves must ignore deaths there. */
  final SealedWorlds sealed = new SealedWorlds();

  final Guards guards = new Guards();
  final Afk afk = new Afk();
  final Land land = new Land();
  final GraveRegistry graves = new GraveRegistry();
  final FaultyStore store;
  final CombatTracker combat;
  final List<UUID> saved = new CopyOnWriteArrayList<>();
  final List<AuditedBlockChanges.Change> recordedChanges = new ArrayList<>();
  @Nullable QolPaper paper;

  private QolHarness(ServerMock server, WorldMock world, StormDatabase database, QolConfig config) {
    this.server = server;
    this.world = world;
    this.database = database;
    this.store = new FaultyStore(new JooqGraveStore(database));
    this.combat = new CombatTracker(clock, config.combat().tagFor());
  }

  /** Starts qol over the database in {@code directory}, which may already hold graves. */
  static QolHarness start(Path directory) {
    return start(directory, false);
  }

  /** Starts qol; with {@code unreadable}, reading graves from storage fails. */
  static QolHarness start(Path directory, boolean unreadable) {
    var server = MockBukkit.mock();
    var world = server.addSimpleWorld("world");
    world.loadChunk(0, 0);
    try {
      Files.writeString(directory.resolve("qol.yml"), Files.readString(SHIPPED));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("qol", QolHarness.class.getClassLoader());
    var config = ConfigFiles.load(directory.resolve("qol.yml"), QolConfig.class);
    var harness = new QolHarness(server, world, database, config);
    harness.store.failLoad = unreadable;
    enabling =
        plugin -> {
          var services = new Services();
          services.provide(
              BlockChanges.class, new AuditedBlockChanges(harness.recordedChanges::add));
          var context =
              new ModuleContext(
                  plugin,
                  plugin.getLifecycleManager(),
                  new PaperScheduler(plugin),
                  new DirectComputePool(),
                  database,
                  services,
                  directory,
                  harness.clock,
                  RandomGenerator.getDefault(),
                  plugin.getComponentLogger());
          harness.paper =
              QolPaper.start(
                  context,
                  config,
                  new QolPaper.App(
                      harness.store,
                      harness.graves,
                      harness.combat,
                      harness.land,
                      harness.guards,
                      harness.afk,
                      harness.sealed),
                  new ServerHooks(
                      GraveFace.PLAIN, player -> harness.saved.add(player.getUniqueId())));
        };
    try {
      MockBukkit.loadWith(
          HarnessPlugin.class,
          new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
      if (!unreadable) {
        harness.until(harness.graves::isLoaded);
      }
    } catch (RuntimeException e) {
      harness.close();
      throw e;
    }
    return harness;
  }

  /** A player standing on the flat world's grass at x, z. */
  PlayerMock playerAt(String name, int x, int z) {
    world.loadChunk(x >> 4, z >> 4);
    var player = server.addPlayer(name);
    player.teleport(new Location(world, x + 0.5, 5, z + 0.5));
    return player;
  }

  /** Runs server ticks until {@code condition} holds, failing after five seconds. */
  void until(BooleanSupplier condition) {
    var deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) {
        throw new AssertionError("condition not met within 5s");
      }
      server.getScheduler().performOneTick();
      Thread.onSpinWait();
    }
  }

  /** Every message {@code player} has been sent since the last call, as plain text. */
  static List<String> messages(PlayerMock player) {
    var out = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      out.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return out;
  }

  /** Runs ticks until {@code player} has been sent a message containing {@code text}. */
  List<String> awaitMessage(PlayerMock player, String text) {
    var seen = new ArrayList<String>();
    try {
      until(
          () -> {
            seen.addAll(messages(player));
            return seen.stream().anyMatch(message -> message.contains(text));
          });
    } catch (AssertionError timeout) {
      throw new AssertionError("Expected message containing " + text + "; saw " + seen, timeout);
    }
    return seen;
  }

  @Override
  public void close() {
    MockBukkit.unmock();
    database.close();
  }
}
