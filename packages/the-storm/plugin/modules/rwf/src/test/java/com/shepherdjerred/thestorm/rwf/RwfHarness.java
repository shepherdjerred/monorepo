package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.economy.app.MoneyFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ChunkHolder;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ServerHooks;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.FeatureGates;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.FakeBotRoster;
import com.shepherdjerred.thestorm.rwf.testing.FakeClock;
import com.shepherdjerred.thestorm.rwf.testing.FakeMobGoals;
import com.shepherdjerred.thestorm.rwf.testing.FakeSavedPlayerData;
import com.shepherdjerred.thestorm.rwf.testing.FakeWallets;
import com.shepherdjerred.thestorm.rwf.testing.RwfServerMock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * The rwf module enabled on a MockBukkit server with the shipped content, a temp SQLite database, a
 * direct compute pool, fake wallets, a fixed clock, an open join gate and a fake bot roster. The
 * {@code rwf} world is a plain WorldMock the module pastes the training yard into.
 */
public final class RwfHarness implements AutoCloseable {

  /** {@code plugins/TheStorm} as the repository ships it. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm");

  /** The recording salt the harness supplies for {@code RWF_RECORDING_SALT}. */
  public static final String SALT = "harness-salt";

  private static final List<String> FILES =
      List.of(
          "rwf.yml",
          "rwf/kits.yml",
          "rwf/maps/training-yard/map.yml",
          "rwf/maps/training-yard/blocks.schem",
          "rwf/maps/training-yard/details.json");

  /**
   * The small test lobby the suites paste: MockBukkit cannot make block data for the walls, panes
   * and lanterns of the shipped war room, which rwfmap and the real-server suites check instead.
   */
  public static final Path FIXTURE_LOBBY = Path.of("src/test/resources/fixtures/lobby");

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the harness, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  /** Chunk tickets are not implemented by MockBukkit; count the calls instead. */
  public static final class CountingChunks implements ChunkHolder {
    public int held;
    public int released;

    @Override
    public void hold(World world, int chunkX, int chunkZ) {
      held++;
    }

    @Override
    public void release(World world, int chunkX, int chunkZ) {
      released++;
    }
  }

  /** MockBukkit has no async chunk API; complete its chunk load without changing module code. */
  private static final class RwfWorldMock extends WorldMock {
    private CompletableFuture<Void> chunkLoads = CompletableFuture.completedFuture(null);

    RwfWorldMock(String name) {
      super(new WorldCreator(name));
    }

    @Override
    public CompletableFuture<Chunk> getChunkAtAsync(
        int x, int z, boolean generate, boolean urgent) {
      return chunkLoads.thenApply(
          _ -> {
            loadChunk(x, z);
            return getChunkAt(x, z);
          });
    }
  }

  public final ServerMock server;
  public final World overworld;
  public final World rwf;
  public final World lobbyWorld;
  public final StormDatabase database;
  public final FakeClock clock = new FakeClock(Samples.T0);
  public final FakeWallets wallets = new FakeWallets();
  public final CountingChunks chunks = new CountingChunks();
  public final Services services = new Services();
  public final FakeBotRoster bots;
  public final SealedWorlds sealed = new SealedWorlds();

  /** The goals mobs were given, as MockBukkit keeps none. */
  public final FakeMobGoals mobGoals = new FakeMobGoals();

  /** The kit and killstreak gates the module is enabled with; every feature on unless replaced. */
  public FeatureGates kitGates = FeatureGates.open();

  public final FakeSavedPlayerData saved = new FakeSavedPlayerData();
  private RwfModule module = new RwfModule();

  /** How long enabling may take to paste the lobby and first map. */
  private static final Duration PREPARATION = Duration.ofSeconds(30);

  /**
   * The match features the managed flags answer with, read as each match opens; every feature off
   * by default, so a match plays as it did before them.
   */
  public volatile com.shepherdjerred.thestorm.rwf.app.RwfFeatures features =
      com.shepherdjerred.thestorm.rwf.app.RwfFeatures.NONE;

  private RwfHarness(
      ServerMock server, World overworld, World rwf, World lobbyWorld, StormDatabase database) {
    this.server = server;
    this.overworld = overworld;
    this.rwf = rwf;
    this.lobbyWorld = lobbyWorld;
    this.database = database;
    this.bots = new FakeBotRoster(server);
  }

  /** Starts a server and database; {@link #enable} starts the module. */
  public static RwfHarness prepare(Path directory) {
    var server = MockBukkit.mock(RwfServerMock.create());
    var overworld = new RwfWorldMock("world");
    var rwf = new RwfWorldMock("rwf");
    var lobby = new RwfWorldMock("rwf_lobby");
    server.addWorld(overworld);
    server.addWorld(rwf);
    server.addWorld(lobby);
    copyShipped(directory);
    // Existing gameplay cases exercise an explicit eight-combatant profile.
    try {
      var config = directory.resolve("rwf.yml");
      Files.writeString(
          config,
          Files.readString(config)
              .replace("automaticSizing: true", "automaticSizing: false")
              // Keep original flow scenarios explicit and short; native acceptance uses 30s.
              .replace("previewLength: PT30S", "previewLength: PT10S")
              // The gameplay cases count down as soon as Alice is in, as before the relaxing
              // requirement; RwfLobbyFillTest plays the shipped 4-to-2 rule.
              .replace("minPlayers: 4", "minPlayers: 1")
              .replace("absoluteMinPlayers: 2", "absoluteMinPlayers: 1"));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", RwfHarness.class.getClassLoader());
    return new RwfHarness(server, overworld, rwf, lobby, database);
  }

  /** Enables the module with bots available and the shipped config. */
  public RwfHarness enable(Path directory) {
    return enable(directory, true, Map.of());
  }

  /**
   * Enables the module; {@code withBots} publishes the fake roster first, {@code environment} adds
   * to the variables the module reads (the salt is always present).
   */
  public RwfHarness enable(Path directory, boolean withBots, Map<String, String> environment) {
    enableModule(directory, withBots, environment);
    try {
      // Pasting the lobby and first map takes longer on a busy machine than a gameplay step.
      until(() -> view().current().isPresent(), PREPARATION, "lobby admission");
      // With one map to offer, the lobby chooses it at once and its terrain is ready before anyone
      // joins, as it was before the vote: the snapshot has the map's teams once it is loaded.
      if (((RwfWorldMock) rwf).chunkLoads.isDone()
          && !(features.matchFlow() && features.candidateVisits())) {
        until(
            () -> view().current().filter(snapshot -> !snapshot.teams().isEmpty()).isPresent(),
            PREPARATION,
            "initial map teams");
      }
    } catch (AssertionError e) {
      // A harness that never opened must not leave MockBukkit mocking for the next test.
      close();
      throw e;
    }
    return this;
  }

  /** Enables without advancing Paper's scheduler, before the lobby's preparation can finish. */
  public RwfHarness enableBeforeLobby(Path directory) {
    enableModule(directory, true, Map.of());
    return this;
  }

  private void enableModule(Path directory, boolean withBots, Map<String, String> environment) {
    services.provide(
        com.shepherdjerred.thestorm.core.world.BlockChanges.class,
        new com.shepherdjerred.thestorm.core.world.AuditedBlockChanges(_ -> {}));
    services.provide(Wallets.class, wallets);
    services.provide(MoneyFormatter.class, wallets);
    services.provide(SealedWorlds.class, sealed);
    services.provide(SavedPlayerData.class, saved);
    services.provide(PublicGameDirectory.class, new PublicGameDirectory());
    if (withBots) {
      services.provide(BotRoster.class, bots);
    }
    module =
        new RwfModule(
            new RwfModule.Hooks(
                name ->
                    name.equals("RWF_RECORDING_SALT")
                        ? Optional.of(SALT)
                        : Optional.ofNullable(environment.get(name)),
                Optional.of(JoinGate.open()),
                Optional.of(
                    new ServerHooks(chunks, display -> {}, (a, b) -> true, player -> {}, mobGoals)),
                Optional.of(() -> CompletableFuture.completedFuture(features)),
                Optional.of(kitGates)));
    enabling =
        plugin -> {
          services.provide(
              com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl.class,
              new com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl(plugin));
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
    } finally {
      // onEnable runs synchronously; retaining its callback would retain this server between tests.
      enabling = plugin -> {};
    }
  }

  public static RwfHarness start(Path directory) {
    return prepare(directory).enable(directory);
  }

  /** Holds map chunk loads so a test can start a match while its terrain is preparing. */
  CompletableFuture<Void> deferMapChunks() {
    var world = (RwfWorldMock) rwf;
    world.chunkLoads = new CompletableFuture<>();
    return world.chunkLoads;
  }

  public MatchView view() {
    return services.require(MatchView.class);
  }

  public MatchEvents events() {
    return services.require(MatchEvents.class);
  }

  public CombatantActions actions() {
    return services.require(CombatantActions.class);
  }

  public MatchSnapshot snapshot() {
    return view().current().orElseThrow();
  }

  /** Whether {@code player} is in the match, as the read model sees it. */
  public boolean inMatch(PlayerMock player) {
    return snapshot().combatant(new CombatantId.Human(player.getUniqueId())).isPresent();
  }

  /** The combatant view of {@code player}. */
  public MatchSnapshot.CombatantView combatant(PlayerMock player) {
    return snapshot().combatant(new CombatantId.Human(player.getUniqueId())).orElseThrow();
  }

  /**
   * Joins until the match accepts the player and they stand in the lobby world: right after enable,
   * snapshots are still being read back.
   */
  public void enter(PlayerMock player) {
    until(
        () -> {
          player.performCommand("rwf join");
          return inMatch(player);
        });
    until(() -> player.getWorld().equals(lobbyWorld));
  }

  /** A player with belongings to lose, standing in the overworld. */
  public PlayerMock loadedPlayer(String name) {
    var player = server.addPlayer(name);
    player.teleport(new Location(overworld, 50.5, 70, -20.5, 45, 10));
    player.getInventory().addItem(ItemStack.of(Material.DIAMOND, 5));
    player.getInventory().setItem(EquipmentSlot.HEAD, ItemStack.of(Material.IRON_HELMET));
    player.setLevel(7);
    player.setExp(0.5f);
    player.setTotalExperience(160);
    player.setHealth(13);
    player.setFoodLevel(15);
    player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 1_000_000, 1));
    return player;
  }

  /**
   * Joins {@code player}, lets the countdown fill the match with bots, jumps the clock past the
   * countdown so the match goes live, and has {@code player} look around so they are not AFK.
   */
  public void goLive(PlayerMock player) {
    goLiveIdle(player);
    lookAround(player);
  }

  /** {@link #goLive} without looking around: {@code player} stays AFK. */
  public void goLiveIdle(PlayerMock player) {
    enter(player);
    until(() -> snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    letBotsArrive();
    tick(Duration.ofSeconds(91));
    until(() -> snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
  }

  /** {@code player} turns their head by ten degrees, as a move event. */
  public void lookAround(PlayerMock player) {
    var from = player.getLocation();
    var to = from.clone();
    to.setYaw(from.getYaw() + 10);
    server.getPluginManager().callEvent(new PlayerMoveEvent(player, from, to));
  }

  /**
   * Moves the clock past the first 60% of the 90 s countdown, the window drafted bots walk into the
   * lobby in, so every one has arrived.
   */
  public void letBotsArrive() {
    tick(Duration.ofSeconds(55));
  }

  /** Simulates a new login after Paper saved player data; MockBukkit does not persist NBT. */
  public void rejoinAfterSave(PlayerMock player) {
    server.getPluginManager().callEvent(new PlayerJoinEvent(player, Component.empty()));
  }

  /** One server tick with the clock moved {@code by}. */
  public void tick(Duration by) {
    clock.advance(by);
    server.getScheduler().performOneTick();
  }

  /** {@code count} ticks of 50 ms each. */
  public void ticks(int count) {
    for (var i = 0; i < count; i++) {
      tick(Duration.ofMillis(50));
    }
  }

  /**
   * Ages a damage fixture through one second of entity ticks. MockBukkit's scheduler does not tick
   * entities; clearing native invulnerability cannot expire the match's authoritative hit window.
   */
  public static void elapseHitWindow(PlayerMock victim) {
    for (var tick = 0; tick < 20; tick++) {
      victim.tick();
    }
  }

  /** Runs server ticks (clock still) until {@code condition} holds, failing after five seconds. */
  public void until(BooleanSupplier condition) {
    until(condition, Duration.ofSeconds(5));
  }

  /** Runs server ticks (clock still) until {@code condition} holds, failing after {@code limit}. */
  public void until(BooleanSupplier condition, Duration limit) {
    until(condition, limit, "condition");
  }

  private void until(BooleanSupplier condition, Duration limit, String description) {
    var deadline = System.nanoTime() + limit.toNanos();
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) {
        throw new AssertionError(description + " not met within " + limit);
      }
      server.getScheduler().performOneTick();
      // Database and chunk completions need CPU between main-thread ticks. A spin hint does not
      // yield it, so a busy CI worker can starve the work this condition is waiting for.
      LockSupport.parkNanos(Duration.ofMillis(1).toNanos());
    }
  }

  /** Every message {@code player} has been sent since the last call, as plain text. */
  public static List<String> messages(PlayerMock player) {
    var out = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      out.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return out;
  }

  private static void copyShipped(Path directory) {
    try {
      for (var file : FILES) {
        var target = directory.resolve(file);
        Files.createDirectories(target.getParent());
        Files.copy(SHIPPED.resolve(file), target);
      }
      var lobby = directory.resolve("rwf/lobby");
      Files.createDirectories(lobby);
      for (var file : List.of("lobby.yml", "blocks.schem")) {
        Files.copy(FIXTURE_LOBBY.resolve(file), lobby.resolve(file));
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** Disables the module, as the plugin would. */
  public void disable() {
    module.disable();
  }

  @Override
  public void close() {
    MockBukkit.unmock();
    database.close();
  }
}
