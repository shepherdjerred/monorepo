package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.shards.domain.AltarSky;
import com.shepherdjerred.thestorm.shards.domain.Altars;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import java.util.function.Function;
import org.bukkit.World;
import org.bukkit.block.Block;

/**
 * What the altar listener needs besides the shared kit.
 *
 * @param altars the altar blocks and the per-player cooldown
 * @param upgrades the upgrade rules
 * @param scheduler for the delayed lightning bolts
 * @param sky reads the weather over an altar block
 */
record AltarSetup(
    Altars altars, Upgrades upgrades, Scheduler scheduler, Function<Block, AltarSky> sky) {

  /** The weather over {@code block}, from the world and its biome. */
  static AltarSky paperSky(Block block) {
    var world = block.getWorld();
    return new AltarSky(
        world.getEnvironment() == World.Environment.NORMAL,
        world.hasStorm(),
        block.getTemperature(),
        block.getHumidity());
  }
}
