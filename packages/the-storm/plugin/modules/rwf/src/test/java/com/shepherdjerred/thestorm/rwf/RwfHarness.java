package com.shepherdjerred.thestorm.rwf;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ChunkHolder;
import com.shepherdjerred.thestorm.rwf.adapter.paper.ServerHooks;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.CombatantActions;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.FakeBotRoster;
import com.shepherdjerred.thestorm.rwf.testing.FakeClock;
import com.shepherdjerred.thestorm.rwf.testing.FakeWallets;
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
          "rwf/maps/training-yard/blocks.schem");

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
    RwfWorldMock(String name) {
      super(new WorldCreator(name));
    }

    @Override
    public CompletableFuture<Chunk> getChunkAtAsync(
        int x, int z, boolean generate, boolean urgent) {
      loadChunk(x, z);
      return CompletableFuture.completedFuture(getChunkAt(x, z));
    }
  }

  public final ServerMock server;
  public final World overworld;
  public final World rwf;
  public final StormDatabase database;
  public final FakeClock clock = new FakeClock(Samples.T0);
  public final FakeWallets wallets = new FakeWallets();
  public final CountingChunks chunks = new CountingChunks();
  public final Services services = new Services();
  public final FakeBotRoster bots;
  public final SealedWorlds sealed = new SealedWorlds();
  private RwfModule module = new RwfModule();

  private RwfHarness(ServerMock server, World overworld, World rwf, StormDatabase database) {
    this.server = server;
    this.overworld = overworld;
    this.rwf = rwf;
    this.database = database;
    this.bots = new FakeBotRoster(server);
  }

  /** Starts a server and database; {@link #enable} starts the module. */
  public static RwfHarness prepare(Path directory) {
    var server = MockBukkit.mock();
    var overworld = new RwfWorldMock("world");
    var rwf = new RwfWorldMock("rwf");
    server.addWorld(overworld);
    server.addWorld(rwf);
    copyShipped(directory);
    var database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", RwfHarness.class.getClassLoader());
    return new RwfHarness(server, overworld, rwf, database);
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
    services.provide(Wallets.class, wallets);
    services.provide(CrystalFormatter.class, wallets);
    services.provide(SealedWorlds.class, sealed);
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
                Optional.of(new ServerHooks(chunks, display -> {}, (a, b) -> true, player -> {}))));
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
    until(() -> view().current().isPresent());
    return this;
  }

  public static RwfHarness start(Path directory) {
    return prepare(directory).enable(directory);
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
   * Joins until the match accepts the player and they stand in the rwf world: right after enable,
   * snapshots are still being read back.
   */
  public void enter(PlayerMock player) {
    until(
        () -> {
          player.performCommand("rwf join");
          return inMatch(player);
        });
    until(() -> player.getWorld().equals(rwf));
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
   * Joins {@code player}, lets the countdown fill the match with bots, and jumps the clock past the
   * countdown so the match goes live.
   */
  public void goLive(PlayerMock player) {
    enter(player);
    until(() -> snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    tick(Duration.ofSeconds(91));
    until(() -> snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
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

  /** Runs server ticks (clock still) until {@code condition} holds, failing after five seconds. */
  public void until(BooleanSupplier condition) {
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
