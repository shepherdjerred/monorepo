package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import java.net.InetAddress;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.random.RandomGenerator;
import org.bukkit.Chunk;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class SpawnPreparationTest {

  @TempDir Path directory;
  private ServerMock server;
  private PendingWorld world;
  private ModuleContext context;
  private EssentialsConfig config;
  private StormDatabase database;
  private AtomicBoolean stopped;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    stopped = new AtomicBoolean();
    world = new PendingWorld();
    server.addWorld(world);
    world.getBlockAt(68, 68, 66).setType(Material.STONE);
    world.getBlockAt(68, 69, 66).setType(Material.AIR);
    world.getBlockAt(68, 70, 66).setType(Material.AIR);
    var plugin = MockBukkit.createMockPlugin();
    database = StormDatabase.open(directory.resolve("test.db"));
    context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            new PaperScheduler(plugin),
            database,
            new Services(),
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            plugin.getComponentLogger());
    config =
        ConfigFiles.load(
            Path.of("../../../server/owned/plugins/TheStorm/essentials.yml"),
            EssentialsConfig.class);
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
    database.close();
  }

  @Test
  void keepsLoginsClosedUntilTheExistingChunkIsValidatedOnTheMainThread() {
    var preparation = SpawnPreparation.start(context, config, () -> stopped.set(true));
    assertThat(login(preparation)).isEqualTo(AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    world.pending.complete(world.getChunkAt(4, 4));
    server.getScheduler().performOneTick();
    assertThat(login(preparation)).isEqualTo(AsyncPlayerPreLoginEvent.Result.ALLOWED);
    assertThat(stopped.get()).isFalse();
    assertThat(world.requestedGeneration).isFalse();
  }

  @Test
  void stopsAndKeepsLoginsClosedIfTheChunkCannotLoad() {
    var preparation = SpawnPreparation.start(context, config, () -> stopped.set(true));
    world.pending.completeExceptionally(new IllegalStateException("disk unavailable"));
    server.getScheduler().performOneTick();
    assertThat(login(preparation)).isEqualTo(AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    assertThat(stopped.get()).isTrue();
  }

  @Test
  void stopsIfTheLoadedSpawnIsUnsafe() {
    var preparation = SpawnPreparation.start(context, config, () -> stopped.set(true));
    world.getBlockAt(68, 68, 66).setType(Material.LAVA);
    world.pending.complete(world.getChunkAt(4, 4));
    server.getScheduler().performOneTick();
    assertThat(login(preparation)).isEqualTo(AsyncPlayerPreLoginEvent.Result.KICK_OTHER);
    assertThat(stopped.get()).isTrue();
  }

  @Test
  void alreadyLoadedUnsafeSpawnFailsImmediately() {
    world.loaded = true;
    world.getBlockAt(68, 69, 66).setType(Material.STONE);
    assertThatThrownBy(() -> SpawnPreparation.start(context, config))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("is not safe");
  }

  private static AsyncPlayerPreLoginEvent.Result login(SpawnPreparation preparation) {
    var id = UUID.randomUUID();
    var address = InetAddress.getLoopbackAddress();
    var event =
        new AsyncPlayerPreLoginEvent(
            "Alice",
            address,
            address,
            id,
            false,
            org.bukkit.Bukkit.createProfile(id, "Alice"),
            "localhost",
            null);
    preparation.onLogin(event);
    return event.getLoginResult();
  }

  private static final class PendingWorld extends WorldMock {
    final CompletableFuture<Chunk> pending = new CompletableFuture<>();
    boolean loaded;
    boolean requestedGeneration;

    PendingWorld() {
      super(new WorldCreator("world"));
    }

    @Override
    public boolean isChunkLoaded(int x, int z) {
      return loaded;
    }

    @Override
    public CompletableFuture<Chunk> getChunkAtAsync(
        int x, int z, boolean generate, boolean urgent) {
      requestedGeneration = generate;
      return pending;
    }
  }
}
