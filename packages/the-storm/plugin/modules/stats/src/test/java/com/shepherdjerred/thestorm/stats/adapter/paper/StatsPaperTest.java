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
import com.shepherdjerred.thestorm.towns.app.TownListings;
import com.shepherdjerred.thestorm.towns.app.TownMembership;
import com.shepherdjerred.thestorm.towns.app.TownRead;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageIndex;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
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
    drainMessages(alice);
    assertThat(server.dispatchCommand(alice, "stats")).isTrue();
    var overviewReply = awaitNextMessage(alice);
    assertThat(overviewReply).isNotNull();

    drainMessages(alice);
    assertThat(server.dispatchCommand(alice, "stats Alice")).isTrue();
    var profileHeader = awaitNextMessage(alice);
    assertThat(profileHeader).isNotNull();

    drainMessages(alice);
    assertThat(server.dispatchCommand(alice, "stats player UnknownPerson")).isTrue();
    assertThat(awaitNextMessage(alice)).isNotNull();

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
    when(wallets.balance(new AccountId.Player(carol.getUniqueId()), CurrencyId.RWF_CREDITS))
        .thenReturn(CompletableFuture.completedFuture(Money.rwfCredits(340L)));
    when(wallets.balance(new AccountId.Player(dan.getUniqueId()), CurrencyId.CRYSTALS))
        .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("wallet db offline")));
    when(wallets.balance(new AccountId.Player(dan.getUniqueId()), CurrencyId.RWF_CREDITS))
        .thenReturn(CompletableFuture.completedFuture(Money.rwfCredits(15L)));
    customServices.provide(Wallets.class, wallets);

    var siblingCacheCleared = new java.util.concurrent.atomic.AtomicBoolean(false);
    var savedArenaWave = new java.util.concurrent.atomic.AtomicInteger(12);
    var quests = mock(QuestCompletions.class);
    when(quests.counted(carol.getUniqueId()))
        .thenAnswer(inv -> siblingCacheCleared.get() ? OptionalInt.empty() : OptionalInt.of(7));
    when(quests.counted(dan.getUniqueId())).thenReturn(OptionalInt.empty());
    customServices.provide(QuestCompletions.class, quests);

    customServices.provide(ArenaCatalog.class, () -> List.of("colosseum"));
    var arenaRecords = mock(ArenaRecords.class);
    when(arenaRecords.bestWave(carol.getUniqueId(), "colosseum"))
        .thenAnswer(inv -> CompletableFuture.completedFuture(OptionalInt.of(savedArenaWave.get())));
    when(arenaRecords.bestWave(dan.getUniqueId(), "colosseum"))
        .thenReturn(CompletableFuture.completedFuture(OptionalInt.empty()));
    customServices.provide(ArenaRecords.class, arenaRecords);

    // Register sibling MONITOR quit listener BEFORE StatsSessionListener, matching TheStormPlugin:
    // evicts quests cache AND persists final Mob Arena wave record at MONITOR.
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
                savedArenaWave.set(20);
              }
            },
            harnessPlugin);

    var customConfig =
        new StatsConfig(
            "The Storm",
            "https://stats.ts-mc.net",
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
        var listener =
            new StatsSessionListener(customService, reader, sampler::prepareQuitSnapshot);
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
          assertThat(sampledSnapshots.getFirst().crystals()).isEqualTo(1250L);
          assertThat(sampledSnapshots.getFirst().rwfCredits()).isEqualTo(340L);

          exportedBatches.clear();
          when(wallets.balance(new AccountId.Player(carol.getUniqueId()), CurrencyId.CRYSTALS))
              .thenReturn(CompletableFuture.completedFuture(Money.crystals(1900L)));
          when(wallets.balance(new AccountId.Player(carol.getUniqueId()), CurrencyId.RWF_CREDITS))
              .thenReturn(CompletableFuture.completedFuture(Money.rwfCredits(420L)));

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

          // Simulate a late completion from an earlier periodic sample — must NOT overwrite quit
          // or a newer empty-server snapshot!
          var newerEmptyServer =
              new StatsWire.ServerSnapshot(now.get().toString(), List.of(), 64, 0, List.of());
          var stalePopulatedServer =
              new StatsWire.ServerSnapshot(
                  now.get().minusSeconds(15).toString(),
                  List.of(
                      new StatsWire.OnlinePlayerSummary(
                          carol.getUniqueId().toString(),
                          "Carol",
                          "survival",
                          "world",
                          false,
                          20,
                          now.get().minusSeconds(50).toString())),
                  64,
                  0,
                  List.of());
          customService.bufferSnapshots(newerEmptyServer, List.of());
          customService.bufferSnapshots(
              stalePopulatedServer,
              List.of(
                  new StatsWire.PlayerGameplaySnapshot(
                      carol.getUniqueId().toString(),
                      "Carol",
                      now.get().minusSeconds(15).toString(),
                      null,
                      "default",
                      99L,
                      10L,
                      null,
                      null,
                      null,
                      0,
                      0,
                      null,
                      0,
                      Map.of(),
                      null,
                      null,
                      Map.of(),
                      0,
                      0,
                      0,
                      0,
                      0)));

          customService.flush().get();
          var quitSnapshots =
              exportedBatches.stream().flatMap(b -> b.playerSnapshots().stream()).toList();
          assertThat(quitSnapshots)
              .extracting(StatsWire.PlayerGameplaySnapshot::crystals)
              .containsExactly(1900L);
          assertThat(quitSnapshots)
              .extracting(StatsWire.PlayerGameplaySnapshot::rwfCredits)
              .containsExactly(420L);
          assertThat(quitSnapshots.getFirst().questsCompleted()).isEqualTo(7);
          assertThat(quitSnapshots.getFirst().arenaBestWaves()).containsEntry("colosseum", 20);
          var exportedServer =
              exportedBatches.stream()
                  .map(StatsWire.IngestBatch::serverSnapshot)
                  .filter(java.util.Objects::nonNull)
                  .findFirst()
                  .orElseThrow();
          assertThat(exportedServer.onlinePlayers()).isEmpty();
        } finally {
          org.bukkit.event.HandlerList.unregisterAll(listener);
          org.bukkit.event.HandlerList.unregisterAll(siblingQuitListener);
          unsub.run();
        }
      }
    }
  }

  @Test
  void samplesCrystalsRwfCreditsCampsTownRolesAndFilteredMultiPageTownSummaries() throws Exception {
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

    var campOwner = addHumanPlayer("CampFounder");
    var townOwner = addHumanPlayer("MayorBob");
    var townAssistant = addHumanPlayer("DeputyCarol");
    var townMember = addHumanPlayer("CitizenDan");
    var nomad = addHumanPlayer("NomadEve");

    var state = new TownsState(new RegionIndex(List.of()));
    var aegisSite =
        new HeritageSite(
            "aegis-keep",
            "Aegis",
            HeritageSite.Kind.PLAYER,
            "Aegis",
            "world",
            RegionProfile.PRESERVE,
            Set.of(new HeritageSite.Chunk(0, 0), new HeritageSite.Chunk(0, 1)),
            List.of(),
            Set.of(new HeritageSite.Chunk(0, 0)),
            List.of(new HeritageSite.Editor(townOwner.getUniqueId(), "MayorBob")),
            "Imported player town");
    var museumSite =
        new HeritageSite(
            "dragon-house",
            "_D_R_A_G_O_N's House",
            HeritageSite.Kind.HERITAGE,
            "",
            "world",
            RegionProfile.PRESERVE,
            Set.of(new HeritageSite.Chunk(50, 50)),
            List.of(),
            Set.of(),
            List.of(),
            "Archive museum site");
    var spawnSite =
        new HeritageSite(
            "spawn-plaza",
            "Spawn",
            HeritageSite.Kind.SERVER,
            "",
            "world",
            RegionProfile.PRESERVE,
            Set.of(new HeritageSite.Chunk(100, 100), new HeritageSite.Chunk(100, 101)),
            List.of(),
            Set.of(),
            List.of(),
            "Server admin region");
    state.attachHeritage(new HeritageIndex(List.of(aegisSite, museumSite, spawnSite)));

    var campId = java.util.UUID.randomUUID();
    var camp = Town.camp(campId, "CampFounder", now.get(), campOwner.getUniqueId());
    state.addTown(camp);
    state.addClaim(new Claim(new ChunkPos("world", 30, 30), campId, ClaimFlags.none()));

    var aegisId = aegisSite.activeTownId().orElseThrow();
    var aegisTown =
        Town.found(aegisId, "Aegis", now.get(), townOwner.getUniqueId())
            .withMember(townAssistant.getUniqueId(), TownRole.ASSISTANT)
            .withMember(townMember.getUniqueId(), TownRole.MEMBER);
    state.addTown(aegisTown);
    state.addClaim(new Claim(new ChunkPos("world", 10, 10), aegisId, ClaimFlags.none()));
    state.addClaim(new Claim(new ChunkPos("world", 10, 11), aegisId, ClaimFlags.none()));
    state.addClaim(new Claim(new ChunkPos("world", 10, 12), aegisId, ClaimFlags.none()));

    // Add 26 additional player towns so TownListings spans 2 pages (> 25 total directory entries).
    for (int i = 1; i <= 26; i++) {
      var extraTownId = java.util.UUID.randomUUID();
      var extraFounder = java.util.UUID.randomUUID();
      var extraTown =
          Town.found(extraTownId, String.format("Outpost%02d", i), now.get(), extraFounder);
      state.addTown(extraTown);
      state.addClaim(
          new Claim(new ChunkPos("world", 200 + i, 200), extraTownId, ClaimFlags.none()));
    }

    var customServices = new Services();
    customServices.provide(TownMembership.class, state);
    customServices.provide(TownRead.class, new TownListings(state));

    var wallets = mock(Wallets.class);
    for (var p : List.of(campOwner, townOwner, townAssistant, townMember, nomad)) {
      long crystals = p.equals(townOwner) ? 4_500L : 800L;
      long rwfCredits = p.equals(townOwner) ? 1_275L : 95L;
      when(wallets.balance(new AccountId.Player(p.getUniqueId()), CurrencyId.CRYSTALS))
          .thenReturn(CompletableFuture.completedFuture(Money.crystals(crystals)));
      when(wallets.balance(new AccountId.Player(p.getUniqueId()), CurrencyId.RWF_CREDITS))
          .thenReturn(CompletableFuture.completedFuture(Money.rwfCredits(rwfCredits)));
    }
    customServices.provide(Wallets.class, wallets);

    var customConfig =
        new StatsConfig(
            "The Storm",
            "https://stats.ts-mc.net",
            "STORM_STATS_INGEST_URL",
            "STORM_STATS_INGEST_TOKEN",
            15,
            60);
    var rng = new SplittableRandom(77L);
    var logger = mock(org.slf4j.Logger.class);
    try (var customDatabase = StormDatabase.open(tempDir.resolve("domain-alignment-stats.db"))) {
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

        sampler.sample();
        customService.flush().get();

        assertThat(exportedBatches).hasSize(1);
        var batch = exportedBatches.getFirst();
        assertThat(batch.schemaVersion()).isEqualTo(2);

        var byName =
            batch.playerSnapshots().stream()
                .collect(
                    java.util.stream.Collectors.toUnmodifiableMap(
                        StatsWire.PlayerGameplaySnapshot::playerName, s -> s));

        var campSnap = java.util.Objects.requireNonNull(byName.get("CampFounder"));
        assertThat(campSnap.crystals()).isEqualTo(800L);
        assertThat(campSnap.rwfCredits()).isEqualTo(95L);
        assertThat(campSnap.townName()).isEqualTo("CampFounder");
        assertThat(campSnap.townKind()).isEqualTo("camp");
        assertThat(campSnap.townRole()).isEqualTo("owner");
        assertThat(campSnap.townClaims()).isEqualTo(1);

        var ownerSnap = java.util.Objects.requireNonNull(byName.get("MayorBob"));
        assertThat(ownerSnap.crystals()).isEqualTo(4_500L);
        assertThat(ownerSnap.rwfCredits()).isEqualTo(1_275L);
        assertThat(ownerSnap.townName()).isEqualTo("Aegis");
        assertThat(ownerSnap.townKind()).isEqualTo("town");
        assertThat(ownerSnap.townRole()).isEqualTo("owner");
        // 3 regular claims + 2 protected heritage chunks = 5
        assertThat(ownerSnap.townClaims()).isEqualTo(5);

        var assistantSnap = java.util.Objects.requireNonNull(byName.get("DeputyCarol"));
        assertThat(assistantSnap.townName()).isEqualTo("Aegis");
        assertThat(assistantSnap.townKind()).isEqualTo("town");
        assertThat(assistantSnap.townRole()).isEqualTo("assistant");
        assertThat(assistantSnap.townClaims()).isEqualTo(5);

        var memberSnap = java.util.Objects.requireNonNull(byName.get("CitizenDan"));
        assertThat(memberSnap.townName()).isEqualTo("Aegis");
        assertThat(memberSnap.townKind()).isEqualTo("town");
        assertThat(memberSnap.townRole()).isEqualTo("member");
        assertThat(memberSnap.townClaims()).isEqualTo(5);

        var nomadSnap = java.util.Objects.requireNonNull(byName.get("NomadEve"));
        assertThat(nomadSnap.townName()).isNull();
        assertThat(nomadSnap.townKind()).isNull();
        assertThat(nomadSnap.townRole()).isNull();
        assertThat(nomadSnap.townClaims()).isZero();

        assertThat(batch.playerSnapshots())
            .extracting(StatsWire.PlayerGameplaySnapshot::townRole)
            .doesNotContain("officer");

        var serverSnap = java.util.Objects.requireNonNull(batch.serverSnapshot());
        // 1 heritage PLAYER town (Aegis) + 26 player towns = 27 PLAYER towns across 2 pages;
        // Spawn (SERVER), _D_R_A_G_O_N's House (HERITAGE), and CampFounder (camp) are excluded!
        assertThat(serverSnap.townsCount()).isEqualTo(27);
        assertThat(serverSnap.towns()).hasSize(27);
        assertThat(serverSnap.towns())
            .extracting(StatsWire.TownSummarySnapshot::name)
            .doesNotContain("Spawn", "_D_R_A_G_O_N's House", "CampFounder")
            .contains("Aegis", "Outpost01", "Outpost26");
        assertThat(serverSnap.towns())
            .extracting(StatsWire.TownSummarySnapshot::kind)
            .containsOnly("player");
        var aegisSummary =
            serverSnap.towns().stream()
                .filter(t -> t.name().equals("Aegis"))
                .findFirst()
                .orElseThrow();
        assertThat(aegisSummary.members()).isEqualTo(3);
        assertThat(aegisSummary.claims()).isEqualTo(5);
      }
    }
  }

  @Test
  void resolvesJoiningPlayerCountryOfflineAndOmitsPrivatePeerAddresses() throws Exception {
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

    var customConfig =
        new StatsConfig(
            "The Storm",
            "https://stats.ts-mc.net",
            "STORM_STATS_INGEST_URL",
            "STORM_STATS_INGEST_TOKEN",
            15,
            60);
    var rng = new SplittableRandom(123L);
    var logger = mock(org.slf4j.Logger.class);
    var json = tools.jackson.databind.json.JsonMapper.builder().build();

    try (var customDatabase = StormDatabase.open(tempDir.resolve("geoip-stats.db"))) {
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
        var ports = StatsPaperPorts.discover(new Services());
        var reader = new PlayerStateReader(server, ports, now::get);
        var listener = new StatsSessionListener(customService, reader);
        server.getPluginManager().registerEvents(listener, harnessPlugin);
        try {
          var publicPlayer = addHumanPlayerWithIp("PublicUsa", "8.8.8.8");
          var tailscalePlayer = addHumanPlayerWithIp("TailnetPeer", "100.96.247.28");
          assertThat(publicPlayer.getName()).isEqualTo("PublicUsa");
          assertThat(tailscalePlayer.getName()).isEqualTo("TailnetPeer");

          waitForAsyncDb(customService);
          var outboxEvents = customStore.pendingEvents(10).get();
          assertThat(outboxEvents).hasSize(2);

          var firstOutboxJson = json.readTree(outboxEvents.get(0).eventJson());
          assertThat(firstOutboxJson.required("type").asString()).isEqualTo("session_started");
          assertThat(firstOutboxJson.required("playerName").asString()).isEqualTo("PublicUsa");
          assertThat(firstOutboxJson.required("countryCode").asString()).isEqualTo("US");
          assertThat(firstOutboxJson.required("countryName").asString()).isEqualTo("United States");
          assertThat(outboxEvents.get(0).eventJson()).doesNotContain("8.8.8.8");

          var secondOutboxJson = json.readTree(outboxEvents.get(1).eventJson());
          assertThat(secondOutboxJson.required("playerName").asString()).isEqualTo("TailnetPeer");
          assertThat(secondOutboxJson.required("countryCode").isNull()).isTrue();
          assertThat(secondOutboxJson.required("countryName").isNull()).isTrue();
          assertThat(outboxEvents.get(1).eventJson()).doesNotContain("100.96.247.28");

          customService.flush().get();
          assertThat(exportedBatches).hasSize(1);
          var wireBatchJson = json.writeValueAsString(exportedBatches.getFirst());
          assertThat(wireBatchJson)
              .contains("\"countryCode\":\"US\"")
              .contains("\"countryName\":\"United States\"")
              .doesNotContain("8.8.8.8")
              .doesNotContain("100.96.247.28");
        } finally {
          org.bukkit.event.HandlerList.unregisterAll(listener);
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

  private PlayerMock addHumanPlayerWithIp(String name, String ipLiteral) {
    var peerAddress =
        new java.net.InetSocketAddress(java.net.InetAddress.ofLiteral(ipLiteral), 25565);
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

          @Override
          public java.net.InetSocketAddress getAddress() {
            return peerAddress;
          }
        };
    server.addPlayer(player);
    return player;
  }

  private Component awaitNextMessage(PlayerMock player) {
    long deadlineNanos = System.nanoTime() + Duration.ofSeconds(5).toNanos();
    while (System.nanoTime() < deadlineNanos) {
      server.getScheduler().performTicks(1L);
      var msg = player.nextComponentMessage();
      if (msg != null) {
        return msg;
      }
      java.util.concurrent.locks.LockSupport.parkNanos(2_000_000L);
    }
    throw new AssertionError("Timed out waiting for async /stats command reply");
  }

  private static void drainMessages(PlayerMock player) {
    while (player.nextComponentMessage() != null) {
      // Drain buffered chat messages
    }
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
    when(wallets.balance(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq(CurrencyId.RWF_CREDITS)))
        .thenReturn(CompletableFuture.completedFuture(Money.rwfCredits(50L)));
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
