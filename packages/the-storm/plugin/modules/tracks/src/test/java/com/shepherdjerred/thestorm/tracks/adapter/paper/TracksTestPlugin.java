package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.tracks.adapter.db.JooqTrackStore;
import com.shepherdjerred.thestorm.tracks.app.FakePermissionSync;
import com.shepherdjerred.thestorm.tracks.app.FakeWallets;
import com.shepherdjerred.thestorm.tracks.app.LevelCache;
import com.shepherdjerred.thestorm.tracks.app.PurchaseService;
import com.shepherdjerred.thestorm.tracks.app.TrackAdmin;
import com.shepherdjerred.thestorm.tracks.app.TrackRuntime;
import com.shepherdjerred.thestorm.tracks.app.TrackSessions;
import com.shepherdjerred.thestorm.tracks.domain.Progressions;
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
  final FakePlayerDirectory players = new FakePlayerDirectory();
  final LevelCache cache = new LevelCache();
  @Nullable FakePermissionSync permissions;
  private @Nullable StormDatabase database;

  FakePermissionSync permissions() {
    return Objects.requireNonNull(permissions, "permissions");
  }

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(TracksTestPlugin.directory, "directory");
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    database.migrate("tracks", TracksTestPlugin.class.getClassLoader());
    var config = ConfigFiles.load(SHIPPED_CONFIG, TracksConfig.class);
    var scheduler = new PaperScheduler(this);
    var services = new Services();
    services.provide(PlayerDirectory.class, players);
    services.provide(CrystalFormatter.class, new TestFormatter());
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            scheduler,
            database,
            services,
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    var store = new JooqTrackStore(database);
    var sync = new FakePermissionSync(store);
    permissions = sync;
    var runtime =
        new TrackRuntime(
            store, sync, cache, scheduler, InstantSource.system(), getComponentLogger());
    var purchases =
        new PurchaseService(
            runtime, wallets, PurchaseRules.standard(config.pricing(), config.purchaseCooldown()));
    var sessions = new TrackSessions(runtime, TracksPaper.loadFailedNotice(getServer()));
    TracksPaper.install(
        context, config, new UseCases(purchases, new TrackAdmin(runtime), sessions, cache));
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }

  /** The economy's sentence format, without the economy. */
  private static final class TestFormatter implements CrystalFormatter {

    @Override
    public String words(Crystals amount) {
      return Progressions.crystals(amount.amount());
    }

    @Override
    public String symbol(Crystals amount) {
      return amount.amount() + " CR";
    }
  }
}
