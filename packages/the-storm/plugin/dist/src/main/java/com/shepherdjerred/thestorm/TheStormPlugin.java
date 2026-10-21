package com.shepherdjerred.thestorm;

import static java.util.Comparator.reverseOrder;

import com.shepherdjerred.thestorm.core.analytics.AnalyticsRuntime;
import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.compute.ComputeSettings;
import com.shepherdjerred.thestorm.core.compute.PlatformComputePool;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.ModuleRegistry;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.players.PlayerVisibilityControl;
import com.shepherdjerred.thestorm.core.players.SqlPlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.snapshot.PaperSavedPlayerData;
import com.shepherdjerred.thestorm.core.snapshot.SavedPlayerData;
import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.creative.adapter.paper.CreativeGenerator;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.generator.ChunkGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * The Storm. Reads the repository-owned {@code config.yml}, opens the database and enables the
 * configured modules. A bad config stops the plugin: it never falls back to defaults.
 */
public final class TheStormPlugin extends JavaPlugin {

  private final List<StormModule> enabled = new ArrayList<>();
  private final Services services = new Services();
  private @Nullable StormDatabase database;
  private @Nullable ComputePool compute;
  private @Nullable AnalyticsPaper analytics;
  private @Nullable PlayerVisibilityControl visibility;
  private com.shepherdjerred.thestorm.core.expansion.@Nullable ManagedGameplay gameplay;

  /**
   * Enables The Storm or stops the server. Once modules replace third-party plugins (land
   * protection, bans, the economy), running without them is worse than not running: a server with
   * the plugin disabled would let players join with no land protection. So any enable failure is
   * logged and the server is shut down, which keeps the failure loud (the pod restarts and alerts)
   * instead of quietly failing open.
   */
  @Override
  public void onEnable() {
    try {
      enableModules();
    } catch (RuntimeException e) {
      getComponentLogger()
          .error("The Storm failed to enable; stopping the server rather than run unprotected", e);
      getServer().shutdown();
      throw e;
    }
  }

  private void enableModules() {
    var config = readConfig();
    bootstrapCreativeWorld(config);
    loadRecoveredCreativeWorld(config);
    var computeSettings =
        ConfigFiles.load(getDataPath().resolve("compute.yml"), ComputeSettings.class);
    var selected =
        switch (ModuleRegistry.select(Modules.all(), config.toggles())) {
          case Result.Ok<List<StormModule>, List<String>>(var modules) -> modules;
          case Result.Err<List<StormModule>, List<String>>(var problems) ->
              throw new IllegalStateException("Invalid config.yml: " + String.join("; ", problems));
        };
    try {
      Files.createDirectories(getDataPath());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var db = StormDatabase.open(getDataPath().resolve("the-storm.db"));
    database = db;
    var pool = PlatformComputePool.open(getComponentLogger(), computeSettings);
    compute = pool;
    db.migrate("core", getClass().getClassLoader());
    var players = new SqlPlayerDirectory(db);
    services.provide(PlayerDirectory.class, players);
    var visibilityControl = new PlayerVisibilityControl(this);
    visibility = visibilityControl;
    services.provide(PlayerVisibilityControl.class, visibilityControl);
    services.provide(ChunkTickets.class, new ChunkTickets(this));
    services.provide(SealedWorlds.class, new SealedWorlds());
    services.provide(PublicGameDirectory.class, new PublicGameDirectory());
    services.provide(
        SavedPlayerData.class,
        PaperSavedPlayerData.locate(
            getServer(), pool, new PaperScheduler(this), getComponentLogger()));
    services.provide(BlockChanges.class, CoreProtectBlocks.create(this));
    getServer()
        .getPluginManager()
        .registerEvents(
            new PlayerDirectoryListener(players, InstantSource.system(), getComponentLogger()),
            this);
    var productAnalytics = new AnalyticsRuntime(db, InstantSource.system(), getComponentLogger());
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            pool,
            db,
            services,
            getDataPath(),
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger(),
            productAnalytics);
    var analyticsPaper = new AnalyticsPaper(context, productAnalytics);
    analytics = analyticsPaper;
    var rollout =
        com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.remote(
            requiredEnvironment("FLIPT_URL"), requiredEnvironment("FLIPT_ENVIRONMENT"));
    gameplay = rollout;
    services.provide(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class, rollout);
    services.provide(
        com.shepherdjerred.thestorm.core.expansion.ExpansionSettings.class,
        context.loadConfig(
            "expansion.yml", com.shepherdjerred.thestorm.core.expansion.ExpansionSettings.class));
    for (var module : selected) {
      module.enable(context);
      enabled.add(module);
    }
    analyticsPaper.start(rollout);
    getComponentLogger().info("Enabled modules: {}", ModuleRegistry.ids(selected));
  }

  @Override
  public void onDisable() {
    for (var module : enabled.reversed()) {
      module.disable();
    }
    enabled.clear();
    if (visibility != null) {
      visibility.close();
      visibility = null;
    }
    if (analytics != null) {
      analytics.close();
      analytics = null;
    }
    services.clear();
    if (gameplay != null) {
      gameplay.close();
      gameplay = null;
    }
    if (compute != null) {
      compute.close();
      compute = null;
    }
    if (database != null) {
      database.close();
      database = null;
    }
  }

  /** Typed module ports for integrations; fails if the owning module is disabled. */
  public <T> T service(Class<T> type) {
    return services.require(type);
  }

  /**
   * Disposable sandboxes have no restored creative world. When {@code THESTORM_CREATIVE_BOOTSTRAP}
   * is {@code true} and the creative module is on, load that world with this plugin's generator
   * before modules enable. Production does not set the variable, so a missing world still refuses
   * to start.
   */
  private void bootstrapCreativeWorld(PluginConfig config) {
    if (!"true".equalsIgnoreCase(System.getenv("THESTORM_CREATIVE_BOOTSTRAP"))) {
      return;
    }
    if (!Boolean.TRUE.equals(config.modules().get("creative"))) {
      return;
    }
    var existing = getServer().getWorld("creative");
    if (existing != null && !(existing.getGenerator() instanceof CreativeGenerator)) {
      replaceSandboxCreative(existing);
    }
    if (getServer().getWorld("creative") != null) {
      return;
    }
    var generator = getDefaultWorldGenerator("creative", null);
    if (!(generator instanceof CreativeGenerator)) {
      throw new IllegalStateException("Sandbox creative bootstrap has no plot generator");
    }
    var created =
        new WorldCreator("creative").generator(generator).generateStructures(false).createWorld();
    if (created == null || !(created.getGenerator() instanceof CreativeGenerator)) {
      throw new IllegalStateException(
          "Sandbox creative bootstrap loaded " + generatorName(created));
    }
    getComponentLogger().info("Sandbox bootstrap loaded creative with the plot generator");
  }

  /** Multiverse enables first, so it must leave this world's auto-load off. */
  private void loadRecoveredCreativeWorld(PluginConfig config) {
    if (!Boolean.TRUE.equals(config.modules().get("creative"))) {
      return;
    }
    var creative = ConfigFiles.load(getDataPath().resolve("creative.yml"), CreativeConfig.class);
    if (getServer().getWorld(creative.world()) != null) {
      // CreativeModule still rejects an existing world with the wrong generator.
      return;
    }
    RecoveredCreativeData.require(getServer().getWorldContainer().toPath(), creative.world());
    var loaded =
        new WorldCreator(creative.world())
            .generator(CreativeGenerator.open(creative.grid()))
            .generateStructures(false)
            .createWorld();
    if (loaded == null || !(loaded.getGenerator() instanceof CreativeGenerator)) {
      throw new IllegalStateException("Recovered creative loaded " + generatorName(loaded));
    }
    getComponentLogger().info("Loaded recovered creative terrain with the plot generator");
  }

  /**
   * A sandbox sometimes has {@code creative} loaded with the vanilla generator before this plugin
   * can attach the plot generator. Drop that empty world so the next create uses {@link
   * CreativeGenerator}. Production never sets the bootstrap variable.
   */
  private void replaceSandboxCreative(World existing) {
    var found = generatorName(existing);
    var folder = existing.getWorldFolder().toPath();
    getComponentLogger()
        .warn("Sandbox bootstrap is replacing creative, which is loaded as {}", found);
    if (!getServer().unloadWorld(existing, false)) {
      throw new IllegalStateException(
          "Sandbox creative world is already loaded as " + found + " and could not be unloaded");
    }
    deleteSandboxWorld(folder);
  }

  private static void deleteSandboxWorld(Path folder) {
    if (!"creative".equals(String.valueOf(folder.getFileName()))) {
      throw new IllegalStateException("Refusing to remove sandbox world folder " + folder);
    }
    if (!Files.exists(folder)) {
      return;
    }
    try (var walk = Files.walk(folder)) {
      for (var path : walk.sorted(reverseOrder()).toList()) {
        Files.delete(path);
      }
    } catch (IOException e) {
      throw new UncheckedIOException("Sandbox could not remove creative world " + folder, e);
    }
  }

  private static String generatorName(@Nullable World world) {
    if (world == null) {
      return "nothing";
    }
    var generator = world.getGenerator();
    return generator == null ? "no generator" : generator.getClass().getName();
  }

  /**
   * Plot generator for explicitly provisioned creative worlds. Production leaves Multiverse
   * auto-load off and passes the generator instance while this plugin enables.
   */
  @Override
  public @Nullable ChunkGenerator getDefaultWorldGenerator(String worldName, @Nullable String id) {
    if (!"creative".equals(worldName) && !"creative".equals(id)) {
      return null;
    }
    var config = ConfigFiles.load(getDataPath().resolve("creative.yml"), CreativeConfig.class);
    return CreativeGenerator.open(config.grid());
  }

  private PluginConfig readConfig() {
    var file = getDataPath().resolve("config.yml");
    String yaml;
    try {
      yaml = Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("TheStorm requires " + file + " (owned by the repo)", e);
    }
    return switch (StrictYaml.parse(file.toString(), yaml, PluginConfig.class)) {
      case Result.Ok<PluginConfig, List<Problem>>(var value) -> value;
      case Result.Err<PluginConfig, List<Problem>>(var problems) ->
          throw new IllegalStateException(
              "Invalid config.yml: "
                  + String.join("; ", problems.stream().map(Problem::toString).toList()));
    };
  }

  private static String requiredEnvironment(String key) {
    var value = System.getenv(key);
    if (value == null || value.isBlank())
      throw new IllegalStateException("Missing bootstrap " + key);
    return value;
  }
}
