package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.util.UUID;
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer;
import org.bukkit.Chunk;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkLoadEvent;

/** Existing saved content is evidence of a state, never an accusation against its observer. */
public final class ExistingContentJournal implements Listener {
  private final ModuleContext context;
  private final ContentSafety safety;

  public ExistingContentJournal(ModuleContext context, ContentSafety safety) {
    this.context = context;
    this.safety = safety;
  }

  public void loaded() {
    for (var world : context.plugin().getServer().getWorlds())
      for (var chunk : world.getLoadedChunks()) snapshot(chunk);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void chunk(ChunkLoadEvent event) {
    snapshot(event.getChunk());
  }

  private void snapshot(Chunk chunk) {
    var content = new StringBuilder();
    for (var state : chunk.getTileEntities()) append(content, state);
    for (var entity : chunk.getEntities()) {
      var name = entity.customName();
      if (name != null)
        content
            .append(entity.getUniqueId())
            .append(" ")
            .append(GsonComponentSerializer.gson().serialize(name))
            .append('\n');
    }
    save(chunk, content);
  }

  private static void append(StringBuilder content, org.bukkit.block.BlockState state) {
    if (state instanceof Sign sign) {
      for (var side : Side.values())
        content
            .append(state.getLocation())
            .append(" ")
            .append(side)
            .append(" ")
            .append(
                sign.getSide(side).lines().stream()
                    .map(GsonComponentSerializer.gson()::serialize)
                    .toList())
            .append('\n');
    } else if (state instanceof Container container) {
      for (var item : container.getSnapshotInventory().getContents())
        if (item != null && item.hasItemMeta())
          content
              .append(state.getLocation())
              .append(" ")
              .append(item.getType())
              .append(" ")
              .append(item.getItemMeta().getAsString())
              .append('\n');
    }
  }

  private void save(Chunk chunk, StringBuilder content) {
    if (content.isEmpty()) return;
    var submission =
        new ContentSubmission(
            new UUID(context.random().nextLong(), context.random().nextLong()),
            new UUID(0, 0),
            "ExistingContent",
            "existing-content",
            "staff",
            content.toString(),
            "",
            chunk.getWorld().getKey() + ":" + chunk.getX() + ":" + chunk.getZ());
    var _ =
        safety
            .observe(submission, "snapshot-creator-unknown")
            .exceptionally(
                failure -> {
                  context
                      .logger()
                      .error("Saved content snapshot failed: {}", submission.id(), failure);
                  return null;
                });
  }
}
