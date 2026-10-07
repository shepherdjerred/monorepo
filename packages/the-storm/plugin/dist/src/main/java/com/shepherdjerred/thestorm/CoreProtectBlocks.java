package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.core.world.AuditedBlockChanges;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import net.coreprotect.CoreProtect;
import net.coreprotect.CoreProtectAPI;
import org.bukkit.plugin.Plugin;

/** Binds the shared block writer to the required, pinned CoreProtect plugin. */
final class CoreProtectBlocks {
  private CoreProtectBlocks() {}

  static BlockChanges create(Plugin plugin) {
    var installed = plugin.getServer().getPluginManager().getPlugin("CoreProtect");
    if (!(installed instanceof CoreProtect coreProtect)) {
      throw new IllegalStateException("The Storm requires CoreProtect block logging");
    }
    var api = coreProtect.getAPI();
    if (!api.isEnabled() || api.APIVersion() < 12) {
      throw new IllegalStateException("The Storm requires the pinned CoreProtect API");
    }
    return new AuditedBlockChanges(change -> record(api, change));
  }

  private static void record(CoreProtectAPI api, AuditedBlockChanges.Change change) {
    var before = change.before();
    var after = change.after();
    if (!before.getMaterial().isAir()
        && !api.logRemoval(change.actor(), change.location(), before.getMaterial(), before)) {
      throw new IllegalStateException("CoreProtect refused programmatic removal logging");
    }
    if (!after.getMaterial().isAir()
        && !api.logPlacement(change.actor(), change.location(), after.getMaterial(), after)) {
      throw new IllegalStateException("CoreProtect refused programmatic placement logging");
    }
  }
}
