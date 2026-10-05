package com.shepherdjerred.thestorm.rwfbots;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.NavFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.FakeBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.RwfBotsPaper;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The rwfbots module enabled on a MockBukkit server with the shipped config and personalities, the
 * synthetic map's nav artifact under {@code rwf/maps/synthetic}, a temp SQLite database, a direct
 * compute pool, a fixed clock, fake bodies over MockBukkit players, a hand-driven fake rwf match
 * and a chat flag tests flip.
 */
public final class RwfBotsHarness implements AutoCloseable {

  public static final NavArtifact NAV = SyntheticMap.bake();

  /** The synthetic map's west half baked as a lobby: the bots' lobby places on its open floor. */
  public static final NavArtifact LOBBY = SyntheticMap.bakeLobby();

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the harness, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  /** A clock tests move by hand. */
  public static final class FakeClock implements InstantSource {
    private Instant now = FakeMatch.T0;

    @Override
    public Instant instant() {
      return now;
    }

    public void advance(Duration by) {
      now = now.plus(by);
    }
  }

  public final ServerMock server;
  public final WorldMock world;
  public final StormDatabase database;
  public final Services services = new Services();
  public final FakeClock clock = new FakeClock();
  public final FakeMatch match = new FakeMatch(NAV.blocksSha256());
  public final FakeBodies bodies;
  public final RwfBotsModule module;

  /** What the governor hears as the server's recent tick times; MockBukkit has none. */
  public long[] tickTimes = new long[0];

  /** What the managed chat flag answers; read each time chat refreshes it. */
  public final AtomicBoolean chatFlag = new AtomicBoolean(true);

  private RwfBotsHarness(ServerMock server, WorldMock world, StormDatabase database) {
    this.server = server;
    this.world = world;
    this.database = database;
    this.bodies = new FakeBodies(server);
    this.module =
        new RwfBotsModule(
            new RwfBotsModule.Hooks(
                Optional.of(ctx -> bodies),
                Optional.of(world),
                Optional.of(() -> tickTimes),
                Optional.of(
                    new ChatGate() {
                      @Override
                      public CompletableFuture<Boolean> enabled() {
                        return CompletableFuture.completedFuture(chatFlag.get());
                      }

                      @Override
                      public void close() {}
                    })));
  }

  /** Starts the server and enables the module over {@code directory}. */
  public static RwfBotsHarness start(Path directory) {
    return start(directory, UnaryOperator.identity(), harness -> {});
  }

  /**
   * Starts the server with the shipped {@code rwfbots.yml} rewritten by {@code config}, lets {@code
   * before} set the harness up, then enables the module.
   */
  public static RwfBotsHarness start(
      Path directory, UnaryOperator<String> config, Consumer<RwfBotsHarness> before) {
    var server = MockBukkit.mock();
    var world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    for (var x = 0; x < SyntheticMap.SIZE; x++) {
      for (var z = 0; z < SyntheticMap.SIZE; z++) {
        world.getBlockAt(x, 0, z).setType(Material.STONE);
      }
    }
    copyShipped(directory, config);
    var database = StormDatabase.open(directory.resolve("t.db"));
    var harness = new RwfBotsHarness(server, world, database);
    before.accept(harness);
    harness.enable(directory);
    return harness;
  }

  private void enable(Path directory) {
    services.provide(MatchView.class, match);
    services.provide(MatchEvents.class, match);
    services.provide(CombatantActions.class, match);
    enabling =
        plugin ->
            module.enable(
                new ModuleContext(
                    plugin,
                    plugin.getLifecycleManager(),
                    new PaperScheduler(plugin),
                    new DirectComputePool(),
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
    // The records load back through the main thread on the next tick.
    tick();
  }

  public RwfBotsPaper paper() {
    return module.paper().orElseThrow();
  }

  public BotRoster roster() {
    return services.require(BotRoster.class);
  }

  /** One server tick. */
  public void tick() {
    clock.advance(Duration.ofMillis(50));
    server.getScheduler().performOneTick();
  }

  public void ticks(int count) {
    for (var i = 0; i < count; i++) {
      tick();
    }
  }

  private static void copyShipped(Path directory, UnaryOperator<String> rewrite) {
    var personalities = System.getProperty("thestorm.rwfbots.personalities");
    var config = System.getProperty("thestorm.rwfbots.config");
    assertThat(personalities).as("the build passes the shipped personalities").isNotNull();
    assertThat(config).as("the build passes the shipped config").isNotNull();
    try {
      var target = directory.resolve("rwfbots/personalities");
      Files.createDirectories(target);
      try (var files = Files.list(Path.of(personalities))) {
        for (var file : files.filter(f -> f.toString().endsWith(".yml")).toList()) {
          Files.copy(file, target.resolve(file.getFileName()));
        }
      }
      Files.writeString(
          directory.resolve(RwfBotsModule.CONFIG),
          rewrite.apply(Files.readString(Path.of(config))));
      var maps = directory.resolve(NavFiles.MAPS_DIRECTORY).resolve(NAV.mapId());
      Files.createDirectories(maps);
      Files.write(maps.resolve(NavFiles.FILE_NAME), NavCodec.encode(NAV));
      Files.createDirectories(directory.resolve(NavFiles.MAPS_DIRECTORY).resolve("unbaked"));
      var lobby = directory.resolve(NavFiles.LOBBY_DIRECTORY);
      Files.createDirectories(lobby);
      Files.write(lobby.resolve(NavFiles.FILE_NAME), NavCodec.encode(LOBBY));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Override
  public void close() {
    module.disable();
    MockBukkit.unmock();
    database.close();
  }
}
