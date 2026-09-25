package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.tracks.adapter.db.JooqTrackStore;
import com.shepherdjerred.thestorm.tracks.app.FakePermissionSync;
import com.shepherdjerred.thestorm.tracks.app.FakeWallets;
import com.shepherdjerred.thestorm.tracks.app.LevelCache;
import com.shepherdjerred.thestorm.tracks.app.PurchaseService;
import com.shepherdjerred.thestorm.tracks.app.TrackAdmin;
import com.shepherdjerred.thestorm.tracks.app.TrackRuntime;
import com.shepherdjerred.thestorm.tracks.app.TrackSessions;
import com.shepherdjerred.thestorm.tracks.domain.TracksConfig;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRules;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.Objects;
import java.util.random.RandomGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that wires the tracks with the shipped {@code tracks.yml}, a real
 * SQLite store, a fake economy and a fake LuckPerms (MockBukkit has no LuckPerms). Not final:
 * MockBukkit subclasses plugins.
 */
public class TracksTestPlugin extends JavaPlugin {

  static final Path SHIPPED_CONFIG = Path.of("../../../server/owned/plugins/TheStorm/tracks.yml");

  /** Where the test wants the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final FakeWallets wallets = new FakeWallets();
  final FakePermissionSync permissions = new FakePermissionSync();
  final LevelCache cache = new LevelCache();
  private @Nullable StormDatabase database;

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(TracksTestPlugin.directory, "directory");
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    database.migrate("tracks", TracksTestPlugin.class.getClassLoader());
    var config = ConfigFiles.load(SHIPPED_CONFIG, TracksConfig.class);
    var scheduler = new PaperScheduler(this);
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            scheduler,
            database,
            new Services(),
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    var runtime =
        new TrackRuntime(
            new JooqTrackStore(database),
            permissions,
            cache,
            scheduler.mainThread(),
            InstantSource.system(),
            getComponentLogger());
    var purchases =
        new PurchaseService(
            runtime, wallets, PurchaseRules.standard(config.pricing(), config.purchaseCooldown()));
    TracksPaper.install(
        context,
        config,
        new UseCases(purchases, new TrackAdmin(runtime), new TrackSessions(runtime), cache));
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }
}
