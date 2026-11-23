package com.shepherdjerred.thestorm.stats.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.shepherdjerred.thestorm.arena.app.ArenaCatalog;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.app.ActivityFeed;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.quests.app.QuestCompletions;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.stats.StatsModule;
import com.shepherdjerred.thestorm.stats.adapter.db.JooqStatsStore;
import com.shepherdjerred.thestorm.stats.app.StatsConfig;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.app.StatsTransport;
import com.shepherdjerred.thestorm.stats.app.StatsWire;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import io.papermc.paper.plugin.lifecycle.event.LifecycleEventManager;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Player;
import org.bukkit.entity.Zombie;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class StatsPaperTest {

  private static final Path SHIPPED_STATS_YML =
      Path.of("../../../server/owned/plugins/TheStorm/stats.yml");
  private static java.util.function.Consumer<JavaPlugin> enabling = ignored -> {};

  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  @TempDir Path tempDir;

  private ServerMock server;
  private JavaPlugin harnessPlugin;
  private StormDatabase database;
  private StatsModule module;
  private Services services;
  private AtomicReference<Instant> now;

  @BeforeEach
  void setUp() throws Exception {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    server.addSimpleWorld("skylands");
    server.addSimpleWorld("rwf");

    var dataDir = tempDir.resolve("TheStorm");
    Files.createDirectories(dataDir);
    Files.copy(SHIPPED_STATS_YML, dataDir.resolve("stats.yml"));

    database = StormDatabase.open(dataDir.resolve("the-storm.db"));
    services = new Services();
    provideFakeSiblingPorts(services);
    now = new AtomicReference<>(Instant.parse("2026-11-22T18:00:00Z"));
    module = new StatsModule(ignored -> Optional.empty());

    enabling =
        loaded -> {
          LifecycleEventManager<Plugin> lifecycle = loaded.getLifecycleManager();
          var context =
              new ModuleContext(
                  loaded,
                  lifecycle,
                  new PaperScheduler(loaded),
                  new DirectComputePool(),
                  database,
                  services,
                  dataDir,
                  now::get,
                  new SplittableRandom(42L),
                  loaded.getComponentLogger(),
                  ProductAnalytics.disabled());
          module.enable(context);
        };
    harnessPlugin = MockBukkit.load(HarnessPlugin.class);
  }

  @AfterEach
  void tearDown() {
    module.disable();
    database.close();
    MockBukkit.unmock();
  }

  @Test
  void tracksHumanGameplayIgnoresCitizensNpcsAndServesStatsCommand() throws Exception {
    // Citizens NPC joins — must be completely ignored!
    var npc = mock(Player.class);
    when(npc.hasMetadata("NPC")).thenReturn(true);
    when(npc.getName()).thenReturn("RowanNpc");
    server.getPluginManager().callEvent(new PlayerJoinEvent(npc, Component.empty()));

    // Pre-login bounce
    var bounceEvent = mock(AsyncPlayerPreLoginEvent.class);
    when(bounceEvent.getHandlers()).thenReturn(AsyncPlayerPreLoginEvent.getHandlerList());
    when(bounceEvent.getUniqueId()).thenReturn(java.util.UUID.randomUUID());
    when(bounceEvent.getName()).thenReturn("BouncedBob");
    when(bounceEvent.getHostname()).thenReturn("ts-mc.net:25565");
    when(bounceEvent.getLoginResult()).thenReturn(AsyncPlayerPreLoginEvent.Result.KICK_FULL);
    when(bounceEvent.kickMessage()).thenReturn(Component.text("Server is full"));
    server.getPluginManager().callEvent(bounceEvent);

    // Real human players join
    var alice = addHumanPlayer("Alice");
    var bob = addHumanPlayer("Bob");

    now.set(now.get().plusSeconds(45));
    var skylands = server.getWorld("skylands");
    assertThat(skylands).isNotNull();
    alice.teleport(new Location(skylands, 0, 70, 0));
    server
        .getPluginManager()
        .callEvent(new PlayerChangedWorldEvent(alice, server.getWorld("world")));

    now.set(now.get().plusSeconds(15));
    server
        .getPluginManager()
        .callEvent(
            new PlayerGameModeChangeEvent(
                alice, GameMode.CREATIVE, PlayerGameModeChangeEvent.Cause.COMMAND, null));
    alice.setGameMode(GameMode.SURVIVAL);
    server
        .getPluginManager()
        .callEvent(
            new PlayerGameModeChangeEvent(
                alice, GameMode.SURVIVAL, PlayerGameModeChangeEvent.Cause.COMMAND, null));

    // Survival PvP kill: Alice kills Bob with a diamond sword
    alice.getInventory().setItemInMainHand(new ItemStack(Material.DIAMOND_SWORD));
    bob.setKiller(alice);
    server
        .getPluginManager()
        .callEvent(
            new PlayerDeathEvent(
                bob,
                DamageSource.builder(DamageType.PLAYER_ATTACK).build(),
                new ArrayList<>(),
                0,
                Component.text("Bob was slain by Alice"),
                false));

    // Survival PvE kill: Alice kills a Zombie
    var zombie = skylands.spawn(new Location(skylands, 2, 70, 2), Zombie.class);
    zombie.setKiller(alice);
    server
        .getPluginManager()
        .callEvent(
            new EntityDeathEvent(
                zombie, DamageSource.builder(DamageType.PLAYER_ATTACK).build(), List.of()));

    // Trigger periodic sampler tick (1200 ticks = 60s)
    now.set(now.get().plusSeconds(60));
    server.getScheduler().performTicks(1205L);

    var statsService = services.require(StatsService.class);
    // NPC was never recorded; Alice and Bob were recorded
    assertThat(statsService.store().findPlayer("RowanNpc").get()).isEmpty();
    var storedAlice = statsService.store().findPlayer("Alice").get().orElseThrow();
    assertThat(storedAlice.pvpKills()).isEqualTo(1);
    assertThat(storedAlice.mobKills()).isEqualTo(1);
    assertThat(storedAlice.connectedMs()).isGreaterThanOrEqualTo(60_000L);

    // Execute /stats and /stats Alice and /stats player Alice
    alice.nextComponentMessage(); // drain any prior messages
    assertThat(server.dispatchCommand(alice, "stats")).isTrue();
    waitForAsyncDb(statsService);
    server.getScheduler().performTicks(2L);
    var overviewReply = alice.nextComponentMessage();
    assertThat(overviewReply).isNotNull();

    assertThat(server.dispatchCommand(alice, "stats Alice")).isTrue();
    waitForAsyncDb(statsService);
    server.getScheduler().performTicks(2L);
    var profileHeader = alice.nextComponentMessage();
    assertThat(profileHeader).isNotNull();

    assertThat(server.dispatchCommand(alice, "stats player UnknownPerson")).isTrue();
    waitForAsyncDb(statsService);
    server.getScheduler().performTicks(2L);

    // Kick Bob -> bounce + kick session end
    server
        .getPluginManager()
        .callEvent(
            new PlayerKickEvent(
                bob,
                Component.text("Maintenance kick"),
                Component.empty(),
                PlayerKickEvent.Cause.PLUGIN));
    bob.disconnect();

    // PlayerResetRegistry cleans up Alice
    var resets = services.require(PlayerResetRegistry.class);
    resets.stateless("core");
    resets.complete(Set.of("stats"));
    resets.reset(alice.getUniqueId()).get();
    assertThat(statsService.store().findPlayer("Alice").get()).isEmpty();
  }

  @Test
  void splitsAfkTransitionsCapturesQuitSnapshotAndSkipsFailedEnrichment() throws Exception {
    var exportedBatches = new ArrayList<StatsWire.IngestBatch>();
    StatsTransport recordingTransport =
        new StatsTransport() {
          @Override
          public CompletableFuture<Void> send(StatsWire.IngestBatch batch) {
            exportedBatches.add(batch);
            return CompletableFuture.completedFuture(null);
          }

          @Override
          public void close() {}
        };

    var customServices = new Services();
    var afkTracker = new AfkTracker(now::get, Duration.ofMinutes(5), ProductAnalytics.disabled());
    customServices.provide(AfkStatus.class, afkTracker);
    customServices.provide(ActivityFeed.class, afkTracker);

    var carol = addHumanPlayer("Carol");
    var dan = addHumanPlayer("Dan");

    var wallets = mock(Wallets.class);
    when(wallets.balance(new AccountId.Player(carol.getUniqueId()), CurrencyId.CRYSTALS))
        .thenReturn(CompletableFuture.completedFuture(Money.crystals(1250L)));
    when(wallets.balance(new AccountId.Player(dan.getUniqueId()), CurrencyId.CRYSTALS))
        .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("wallet db offline")));
    customServices.provide(Wallets.class, wallets);

    var siblingCacheCleared = new java.util.concurrent.atomic.AtomicBoolean(false);
    var quests = mock(QuestCompletions.class);
    when(quests.counted(carol.getUniqueId()))
        .thenAnswer(inv -> siblingCacheCleared.get() ? OptionalInt.empty() : OptionalInt.of(7));
    when(quests.counted(dan.getUniqueId())).thenReturn(OptionalInt.of(2));
    customServices.provide(QuestCompletions.class, quests);

    // Register sibling MONITOR quit listener BEFORE StatsSessionListener, matching TheStormPlugin
    var siblingQuitListener = new org.bukkit.event.Listener() {};
    server
        .getPluginManager()
        .registerEvent(
            org.bukkit.event.player.PlayerQuitEvent.class,
            siblingQuitListener,
            org.bukkit.event.EventPriority.MONITOR,
            (ignored, rawEvent) -> {
              if (rawEvent instanceof org.bukkit.event.player.PlayerQuitEvent quitEvent
                  && quitEvent.getPlayer().getUniqueId().equals(carol.getUniqueId())) {
                siblingCacheCleared.set(true);
              }
            },
            harnessPlugin);

    var customConfig =
        new StatsConfig(
            "The Storm",
            "https://ts-mc.net",
            "STORM_STATS_INGEST_URL",
            "STORM_STATS_INGEST_TOKEN",
            15,
            60);
    var rng = new SplittableRandom(99L);
    var logger = mock(org.slf4j.Logger.class);
    try (var customDatabase = StormDatabase.open(tempDir.resolve("custom-stats.db"))) {
      customDatabase.migrate("stats", JooqStatsStore.class.getClassLoader());
      var customStore = new JooqStatsStore(customDatabase);
      try (var customService =
          new StatsService(
              new StatsService.Dependencies(
                  customConfig,
                  customStore,
                  recordingTransport,
                  () -> CompletableFuture.completedFuture(true)),
              new StatsService.Clocks(
                  now::get, () -> new java.util.UUID(rng.nextLong(), rng.nextLong()), logger))) {
        var ports = StatsPaperPorts.discover(customServices);
        var reader = new PlayerStateReader(server, ports, now::get);
        var sampler =
            new StatsSampler(
                new StatsSampler.Context(server, customService, ports, reader), now::get, logger);
        var listener = new StatsSessionListener(customService, reader, sampler::samplePlayer);
        server.getPluginManager().registerEvents(listener, harnessPlugin);
        var unsub = afkTracker.observe((uuid, active) -> customService.syncAfk(uuid, !active));

        try {
          afkTracker.joined(carol.getUniqueId());
          customService.playerJoined(reader.joinInput(carol, "ts-mc.net"));
          afkTracker.joined(dan.getUniqueId());
          customService.playerJoined(reader.joinInput(dan, "ts-mc.net"));

          // Carol plays active for 10s, goes AFK for 25s, returns active for 10s, then quits at 45s
          now.set(now.get().plusSeconds(10));
          assertThat(afkTracker.toggle(carol.getUniqueId())).isTrue();
          now.set(now.get().plusSeconds(25));
          assertThat(afkTracker.active(carol.getUniqueId())).isTrue();
          now.set(now.get().plusSeconds(10));

          // Sample while both are online: Carol's enrichment succeeds (1250), Dan's fails
          // (omitted!)
          sampler.sample();
          customService.flush().get();
          assertThat(exportedBatches).isNotEmpty();
          var sampledSnapshots =
              exportedBatches.stream().flatMap(b -> b.playerSnapshots().stream()).toList();
          assertThat(sampledSnapshots)
              .extracting(StatsWire.PlayerGameplaySnapshot::playerName)
              .containsExactly("Carol");
          assertThat(sampledSnapshots.getFirst().coins()).isEqualTo(1250L);

          exportedBatches.clear();
          when(wallets.balance(new AccountId.Player(carol.getUniqueId()), CurrencyId.CRYSTALS))
              .thenReturn(CompletableFuture.completedFuture(Money.crystals(1900L)));

          // Carol earns crystals and quits before the next 60s sampler tick
          now.set(now.get().plusSeconds(5));
          server
              .getPluginManager()
              .callEvent(
                  new org.bukkit.event.player.PlayerQuitEvent(
                      carol,
                      Component.empty(),
                      org.bukkit.event.player.PlayerQuitEvent.QuitReason.DISCONNECTED));
          assertThat(siblingCacheCleared.get()).isTrue();
          afkTracker.left(carol.getUniqueId());

          waitForAsyncDb(customService);
          var carolSummary = customStore.findPlayer("Carol").get().orElseThrow();
          // 10s active + 25s AFK + 10s active + 5s active = 50s connected, 25s active!
          assertThat(carolSummary.connectedMs()).isEqualTo(50_000L);
          assertThat(carolSummary.activeMs()).isEqualTo(25_000L);

          customService.flush().get();
          var quitSnapshots =
              exportedBatches.stream().flatMap(b -> b.playerSnapshots().stream()).toList();
          assertThat(quitSnapshots)
              .extracting(StatsWire.PlayerGameplaySnapshot::coins)
              .containsExactly(1900L);
          assertThat(quitSnapshots.getFirst().questsCompleted()).isEqualTo(7);
        } finally {
          org.bukkit.event.HandlerList.unregisterAll(listener);
          org.bukkit.event.HandlerList.unregisterAll(siblingQuitListener);
          unsub.run();
        }
      }
    }
  }

  private PlayerMock addHumanPlayer(String name) {
    var player =
        new PlayerMock(server, name, java.util.UUID.randomUUID()) {
          @Override
          public String getClientBrandName() {
            return "vanilla";
          }

          @Override
          public int getProtocolVersion() {
            return 775;
          }
        };
    server.addPlayer(player);
    return player;
  }

  private static void waitForAsyncDb(StatsService service) throws Exception {
    service.store().countPlayers().get();
  }

  private static void provideFakeSiblingPorts(Services services) {
    var wallets = mock(Wallets.class);
    when(wallets.balance(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq(CurrencyId.CRYSTALS)))
        .thenReturn(CompletableFuture.completedFuture(Money.crystals(750L)));
    services.provide(Wallets.class, wallets);

    var skills = mock(SkillLevels.class);
    when(skills.progress(org.mockito.ArgumentMatchers.any()))
        .thenReturn(CompletableFuture.completedFuture(new SkillProgress(Map.of())));
    services.provide(SkillLevels.class, skills);

    var townRead = mock(TownRead.class);
    when(townRead.page(
            org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyInt()))
        .thenReturn(new TownRead.Listing(1, List.of(new TownRead.TownSummary("Spawn", 2, 10))));
    when(townRead.claims(org.mockito.ArgumentMatchers.any())).thenReturn(OptionalInt.empty());
    services.provide(TownRead.class, townRead);

    var quests = mock(QuestCompletions.class);
    when(quests.counted(org.mockito.ArgumentMatchers.any())).thenReturn(OptionalInt.of(4));
    services.provide(QuestCompletions.class, quests);

    services.provide(ArenaCatalog.class, () -> List.of("colosseum"));
    var arenaRecords = mock(ArenaRecords.class);
    when(arenaRecords.bestWave(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString()))
        .thenReturn(CompletableFuture.completedFuture(OptionalInt.of(12)));
    services.provide(ArenaRecords.class, arenaRecords);
  }
}
