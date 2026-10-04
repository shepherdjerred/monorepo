package com.shepherdjerred.thestorm.companions.adapter.coreprotect;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.coreprotect.CoreProtectAPI;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;

/** Historical lookups stay off the tick thread. Unknown audit history never permits a mutation. */
public final class NaturalBlockAudit implements AutoCloseable {
  private final CoreProtectAPI api;
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

  public NaturalBlockAudit(CoreProtectAPI api) {
    if (!api.isEnabled() || api.APIVersion() < 12)
      throw new IllegalStateException("companions require the pinned CoreProtect API");
    this.api = api;
  }

  public CompletableFuture<Boolean> natural(Block block, String owner, String actorName) {
    return CompletableFuture.supplyAsync(
        () -> {
          var rows = api.blockLookup(block, Integer.MAX_VALUE);
          if (rows == null) throw new IllegalStateException("CoreProtect lookup failed");
          return rows.stream()
              .map(api::parseResult)
              .allMatch(
                  row ->
                      row.getActionId() != 1
                          || row.getPlayer().equals(owner)
                          || row.getPlayer().equals(actorName)
                          || row.isRolledBack());
        },
        executor);
  }

  /** Check the writer queue again immediately before a world change. */
  public boolean unqueued(Block block, String owner, String actorName) {
    var rows = api.queueLookup(block);
    if (rows == null) throw new IllegalStateException("CoreProtect queue lookup failed");
    return rows.stream()
        .map(api::parseResult)
        .allMatch(
            row ->
                row.getActionId() != 1
                    || row.getPlayer().equals(owner)
                    || row.getPlayer().equals(actorName)
                    || row.isRolledBack());
  }

  public void placed(String owner, Location location, Material material, BlockData data) {
    if (!api.logPlacement(owner, location, material, data))
      throw new IllegalStateException("CoreProtect refused companion placement record");
  }

  public void removed(String owner, Location location, Material material, BlockData data) {
    if (!api.logRemoval(owner, location, material, data))
      throw new IllegalStateException("CoreProtect refused companion removal record");
  }

  @Override
  public void close() {
    executor.shutdownNow();
  }
}
