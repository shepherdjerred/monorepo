package com.shepherdjerred.thestorm.arena;

import com.shepherdjerred.thestorm.arena.adapter.paper.ChunkKeeper;
import com.shepherdjerred.thestorm.arena.domain.geometry.ChunkPos;
import com.shepherdjerred.thestorm.arena.testing.FakeClock;
import com.shepherdjerred.thestorm.arena.testing.FakeWallets;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The arena module enabled on a MockBukkit server with the shipped content, a temp SQLite database,
 * fake wallets and a fixed clock (so waves never start on their own: MockBukkit cannot run a live
 * arena mob). The colosseum's loot chests are placed before the module starts.
 */
public final class ArenaHarness implements AutoCloseable {

  /** {@code plugins/TheStorm} as the repository ships it. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm");

  private static final List<String> FILES =
      List.of("arena.yml", "arena/classes.yml", "arena/waves.yml", "arena/arenas/colosseum.yml");

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the harness, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  /** Chunk tickets are not implemented by MockBukkit; count the calls instead. */
  static final class CountingChunks implements ChunkKeeper {
    int kept;
    int released;

    @Override
    public void keep(World world, List<ChunkPos> chunks) {
      kept += chunks.size();
    }

    @Override
    public void release(World world, List<ChunkPos> chunks) {
      released += chunks.size();
    }
  }

  final ServerMock server;
  final World world;
  final StormDatabase database;
  final FakeClock clock = new FakeClock(Samples.T0);
  final FakeWallets wallets = new FakeWallets();
  final CountingChunks chunks = new CountingChunks();
  final Services services = new Services();

  private ArenaHarness(ServerMock server, World world, StormDatabase database) {
    this.server = server;
    this.world = world;
    this.database = database;
  }

  /** Starts a server and database; {@link #enable} starts the module. */
  static ArenaHarness prepare(Path directory) {
    var server = MockBukkit.mock();
    var world = server.addSimpleWorld("world");
    copyShipped(directory);
    for (var chest :
        List.of(
            new int[] {1002, 61, 1058}, new int[] {1058, 61, 1002}, new int[] {1058, 61, 1058})) {
      world.getBlockAt(chest[0], chest[1], chest[2]).setType(Material.CHEST);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("arena", ArenaHarness.class.getClassLoader());
    return new ArenaHarness(server, world, database);
  }

  /** Enables the arena module as the plugin's only module. */
  ArenaHarness enable(Path directory) {
    services.provide(Wallets.class, wallets);
    services.provide(CrystalFormatter.class, wallets);
    enabling =
        plugin ->
            new ArenaModule(context -> chunks)
                .enable(
                    new ModuleContext(
                        plugin,
                        plugin.getLifecycleManager(),
                        new PaperScheduler(plugin),
                        database,
                        services,
                        directory,
                        clock,
                        RandomGenerator.of("L64X128MixRandom"),
                        plugin.getComponentLogger()));
    try {
      MockBukkit.loadWith(
          HarnessPlugin.class,
          new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
    } catch (RuntimeException e) {
      close();
      throw e;
    }
    return this;
  }

  static ArenaHarness start(Path directory) {
    return prepare(directory).enable(directory);
  }

  private static void copyShipped(Path directory) {
    try {
      for (var file : FILES) {
        var target = directory.resolve(file);
        Files.createDirectories(target.getParent());
        Files.copy(SHIPPED.resolve(file), target);
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
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

  @Override
  public void close() {
    MockBukkit.unmock();
    database.close();
  }
}
