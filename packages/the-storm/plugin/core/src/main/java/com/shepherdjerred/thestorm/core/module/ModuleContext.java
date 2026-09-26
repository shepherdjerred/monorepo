package com.shepherdjerred.thestorm.core.module;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import io.papermc.paper.plugin.lifecycle.event.LifecycleEventManager;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.plugin.Plugin;

/**
 * Everything a module needs from the runtime. Time and randomness are injected so module logic
 * stays deterministic under test.
 *
 * @param plugin the owning plugin, for registering listeners
 * @param lifecycle Paper's lifecycle manager, for registering Brigadier commands
 * @param scheduler the main-thread scheduler port
 * @param database shared storage
 * @param services the ports modules publish to each other
 * @param dataDirectory the plugin data folder
 * @param time the current instant (no time zone: modules format times for display themselves)
 * @param random randomness for drops, chances and rotations
 * @param logger the module logger
 */
public record ModuleContext(
    Plugin plugin,
    LifecycleEventManager<Plugin> lifecycle,
    Scheduler scheduler,
    StormDatabase database,
    Services services,
    Path dataDirectory,
    InstantSource time,
    RandomGenerator random,
    ComponentLogger logger) {

  /** Loads {@code plugins/TheStorm/<fileName>}, which the repository owns. */
  public <T> T loadConfig(String fileName, Class<T> type) {
    return ConfigFiles.load(dataDirectory.resolve(fileName), type);
  }
}
