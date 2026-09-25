package com.shepherdjerred.thestorm.towns;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.concurrent.TimeUnit;
import java.util.random.RandomGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;

/**
 * Enabling fails loudly when towns cannot be loaded, so the plugin (and with it the server) stops
 * instead of running with claims unprotected.
 */
final class TownsModuleTest {

  private static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/towns.yml");

  @TempDir Path directory;

  private StormDatabase database;
  private JavaPlugin plugin;

  @BeforeEach
  void start() {
    MockBukkit.mock().addSimpleWorld("world");
    plugin = MockBukkit.createMockPlugin();
    database = StormDatabase.open(directory.resolve("t.db"));
  }

  @AfterEach
  void stop() {
    database.close();
    MockBukkit.unmock();
  }

  private ModuleContext context() {
    return new ModuleContext(
        plugin,
        plugin.getLifecycleManager(),
        new PaperScheduler(plugin),
        database,
        new Services(),
        directory,
        InstantSource.system(),
        RandomGenerator.getDefault(),
        plugin.getComponentLogger());
  }

  @Test
  void corruptStoredTownsStopTheModule() throws Exception {
    Files.copy(SHIPPED, directory.resolve("towns.yml"));
    database.migrate("towns", TownsModuleTest.class.getClassLoader());
    database
        .write(
            dsl -> {
              // A town nobody owns breaks the one-owner invariant.
              dsl.execute(
                  "INSERT INTO towns_town VALUES ('00000000-0000-4000-8000-00000000000a',"
                      + " 'Aegis', 0)");
              return 0;
            })
        .get(10, TimeUnit.SECONDS);

    assertThatThrownBy(() -> new TownsModule().enable(context()))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aWorldTheServerHasNotLoadedStopsTheModule() throws Exception {
    var config = Files.readString(SHIPPED).replace("worlds: [world]", "worlds: [atlantis]");
    Files.writeString(directory.resolve("towns.yml"), config);

    assertThatThrownBy(() -> new TownsModule().enable(context()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("atlantis");
  }

  @Test
  void aMissingConfigStopsTheModule() {
    assertThatThrownBy(() -> new TownsModule().enable(context()))
        .isInstanceOf(RuntimeException.class);
  }
}
