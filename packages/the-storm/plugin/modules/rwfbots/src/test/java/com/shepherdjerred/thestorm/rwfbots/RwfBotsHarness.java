package com.shepherdjerred.thestorm.rwfbots;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.adapter.paper.ChatListener;
import com.shepherdjerred.thestorm.chat.adapter.paper.PaperChatOutput;
import com.shepherdjerred.thestorm.chat.adapter.paper.PaperNpcChat;
import com.shepherdjerred.thestorm.chat.app.ChannelFormats;
import com.shepherdjerred.thestorm.chat.app.ChannelRegistry;
import com.shepherdjerred.thestorm.chat.app.ChatConfig;
import com.shepherdjerred.thestorm.chat.app.ChatExtensions;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.ChatSnapshot;
import com.shepherdjerred.thestorm.chat.app.ChatStore;
import com.shepherdjerred.thestorm.chat.app.GlobalChatHub;
import com.shepherdjerred.thestorm.chat.app.NpcChat;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.map.MapResourceRegistry;
import com.shepherdjerred.thestorm.rwf.app.map.MapResources;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.NavFiles;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.FakeBodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.RwfBotsPaper;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.TraversalPlayerMock;
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
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
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
  public final MapResourceRegistry maps = new MapResourceRegistry();
  public final FakeClock clock = new FakeClock();
  public final FakeMatch match = new FakeMatch(NAV.blocksSha256());
  public final FakeBodies bodies;
  public final RwfBotsModule module;

  /** What the governor hears as the server's recent tick times; MockBukkit has none. */
  public long[] tickTimes = new long[0];

  /** What the managed chat flag answers; read each time chat refreshes it. */
  public final AtomicBoolean chatFlag = new AtomicBoolean(true);

  /** Chat's registries: tests register match memberships here, as rwf does. */
  public final ChatExtensions chat = new ChatExtensions();

  /** Chat's use cases, for tests that need a player's line to go through chat. */
  public @Nullable ChatService chatService;

  public final AtomicBoolean learningFlag = new AtomicBoolean(false);
  public final AtomicInteger learningEvaluations = new AtomicInteger();

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
                // The synthetic map's west half stands in for the lobby, in the same world.
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
                    }),
                Optional.of(
                    new com.shepherdjerred.thestorm.rwfbots.app.learning.LearningGate() {
                      @Override
                      public CompletableFuture<Decision> evaluate(Context context) {
                        learningEvaluations.incrementAndGet();
                        return CompletableFuture.completedFuture(
                            new Decision(learningFlag.get(), Source.FLIPT));
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

  /** A real chat service over memory, as the chat module provides it; NPC lines go through it. */
  private void provideChat() {
    var service =
        new ChatService(
            new ChatConfig(
                "global",
                new FilterSettings(256, 4, 30),
                "Calm down",
                new ChannelFormats(
                    "[G][<prefix><player>]: <message>",
                    "[W][<prefix><player>]: <message>",
                    "[S][<prefix><player>]: <message>",
                    "[T][<prefix><player>]: <message>",
                    "[Tm][<prefix><player>]: <message>",
                    "[D][<prefix><player>]: <message>"),
                "[<channel>] * <prefix><player> <message>",
                "[<from> -> <to>]: <message>",
                "[<source>][<author>]: <message>"),
            new ChatStore() {
              @Override
              public CompletableFuture<ChatSnapshot> loadAll(Instant now, ChannelKey focus) {
                return CompletableFuture.completedFuture(new ChatSnapshot(Map.of(), Map.of()));
              }

              @Override
              public void saveProfile(UUID player, ChatProfile profile) {}

              @Override
              public void saveMute(UUID player, Mute mute) {}

              @Override
              public void deleteMute(UUID player) {}
            },
            clock,
            chat);
    service.load().join();
    chatService = service;
    services.provide(ChannelRegistry.class, chat);
    services.provide(
        NpcChat.class, new PaperNpcChat(service, new PaperChatOutput(server, service)));
  }

  private void enable(Path directory) {
    provideChat();
    services.provide(MatchView.class, match);
    services.provide(MatchEvents.class, match);
    services.provide(CombatantActions.class, match);
    services.provide(MapResources.class, maps);
    enabling =
        plugin -> {
          // Players' plain chat goes through chat's own listener, as on the server.
          var service = Objects.requireNonNull(chatService);
          plugin
              .getServer()
              .getPluginManager()
              .registerEvents(
                  new ChatListener(
                      service,
                      new GlobalChatHub(
                          service,
                          new PaperChatOutput(server, service),
                          clock,
                          failure -> {
                            throw failure;
                          })),
                  plugin);
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
                  plugin.getComponentLogger(),
                  com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.disabled()));
        };
    try {
      MockBukkit.loadWith(
          HarnessPlugin.class,
          new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
    } catch (RuntimeException e) {
      close();
      throw e;
    }
    var prepared = maps.prepare(match.map());
    // The records and navigation load back through the main thread on the next tick.
    tick();
    assertThat(prepared).isCompletedWithValue(null);
  }

  public RwfBotsPaper paper() {
    return module.paper().orElseThrow();
  }

  public BotRoster roster() {
    return services.require(BotRoster.class);
  }

  /** A native-capability mock player, including vanilla fall attributes omitted by MockBukkit. */
  public PlayerMock player(String name) {
    return new TraversalPlayerMock(server, name);
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
      // The added kits' weights live beside the personalities and load with them.
      Files.copy(
          Path.of(personalities).resolve("../kit-weights.yml").normalize(),
          directory.resolve("rwfbots/kit-weights.yml"));
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
