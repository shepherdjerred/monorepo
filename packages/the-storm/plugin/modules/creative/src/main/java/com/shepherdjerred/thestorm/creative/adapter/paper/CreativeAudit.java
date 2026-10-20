package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.CreativeLogging;
import net.coreprotect.CoreProtect;
import net.coreprotect.config.Config;
import org.bukkit.World;
import org.bukkit.plugin.Plugin;

/**
 * Reads the pinned CoreProtect config for the creative world. A later WorldEdit mask has to wrap
 * {@code event.getExtent()} at {@code BEFORE_HISTORY}, which is the stage before CoreProtect's
 * {@code BEFORE_CHANGE} logger. CoreProtect then records a block only when that inner change
 * succeeds, so a refused road edit is not stored as a break.
 */
public final class CreativeAudit {
  private CreativeAudit() {}

  /** Fails closed when CoreProtect is missing or this world would not record plot edits. */
  public static void require(Plugin plugin, World world) {
    var installed = plugin.getServer().getPluginManager().getPlugin("CoreProtect");
    if (!(installed instanceof CoreProtect coreProtect)) {
      throw new IllegalStateException("Creative requires CoreProtect");
    }
    var api = coreProtect.getAPI();
    if (!api.isEnabled() || api.APIVersion() < 12) {
      throw new IllegalStateException("Creative requires the pinned CoreProtect API");
    }
    var logging = Config.getConfig(world);
    if (logging == null) {
      throw new IllegalStateException("CoreProtect has no config for " + world.getName());
    }
    new CreativeLogging(
            logging.BLOCK_PLACE,
            logging.BLOCK_BREAK,
            logging.SIGN_TEXT,
            logging.BUCKETS,
            logging.ENTITY_CHANGE,
            logging.WORLDEDIT)
        .requireFor(world.getName());
  }
}
