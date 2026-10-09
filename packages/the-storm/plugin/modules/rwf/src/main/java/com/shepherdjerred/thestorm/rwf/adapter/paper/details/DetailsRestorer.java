package com.shepherdjerred.thestorm.rwf.adapter.paper.details;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.function.BooleanSupplier;
import net.kyori.adventure.text.Component;
import org.bukkit.DyeColor;
import org.bukkit.World;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.block.sign.SignSide;
import org.bukkit.inventory.ItemStack;

/** Restores only inventories and literal sign text, in bounded main-thread batches. */
public final class DetailsRestorer {
  public record Target(Scheduler scheduler, World world, BlockPos origin) {}

  private static final int BATCH = 8;
  private final Scheduler scheduler;
  private final World world;
  private final BlockPos origin;
  private final MapDetails details;
  private final BooleanSupplier current;
  private final CompletableFuture<Boolean> result = new CompletableFuture<>();

  private DetailsRestorer(
      Scheduler scheduler,
      World world,
      BlockPos origin,
      MapDetails details,
      BooleanSupplier current) {
    this.scheduler = scheduler;
    this.world = world;
    this.origin = origin;
    this.details = details;
    this.current = current;
  }

  public static CompletableFuture<Boolean> restore(
      Target target, MapDetails details, BooleanSupplier current) {
    var restore =
        new DetailsRestorer(target.scheduler(), target.world(), target.origin(), details, current);
    restore.batch(0);
    return restore.result;
  }

  private void batch(int start) {
    if (!current.getAsBoolean()) {
      result.complete(false);
      return;
    }
    try {
      int count = details.containers().size() + details.signs().size();
      int end = Math.min(count, start + BATCH);
      for (int index = start; index < end; index++) {
        if (index < details.containers().size()) container(details.containers().get(index));
        else sign(details.signs().get(index - details.containers().size()));
      }
      if (end < count) {
        var _ = scheduler.runOnMainThreadLater(Duration.ofMillis(50), () -> batch(end));
      } else result.complete(true);
    } catch (RuntimeException failure) {
      result.completeExceptionally(failure);
    }
  }

  private org.bukkit.block.BlockState state(BlockPos at, String material) {
    var state =
        world.getBlockAt(origin.x() + at.x(), origin.y() + at.y(), origin.z() + at.z()).getState();
    if (!state.getType().getKey().toString().equals(material))
      throw new IllegalStateException("map detail block changed at " + at);
    return state;
  }

  private void container(MapDetails.Container entry) {
    if (!(state(entry.at(), entry.material()) instanceof Container container))
      throw new IllegalStateException("map inventory is not a container");
    var items = ItemStack.deserializeItemsFromBytes(Base64.getDecoder().decode(entry.items()));
    var inventory = container.getSnapshotInventory();
    if (items.length != inventory.getSize())
      throw new IllegalStateException("map inventory slot count differs from container");
    inventory.setContents(items);
    if (!container.update(false, false))
      throw new IllegalStateException("map inventory restore failed");
  }

  private void sign(MapDetails.Sign entry) {
    if (!(state(entry.at(), entry.material()) instanceof Sign sign))
      throw new IllegalStateException("map sign is not a sign");
    face(sign.getSide(Side.FRONT), entry.front());
    face(sign.getSide(Side.BACK), entry.back());
    sign.setWaxed(entry.waxed());
    if (!sign.update(false, false)) throw new IllegalStateException("map sign restore failed");
  }

  private static void face(SignSide side, MapDetails.Face face) {
    for (int line = 0; line < 4; line++) side.line(line, Component.text(face.lines().get(line)));
    side.setColor(DyeColor.valueOf(face.color()));
    side.setGlowingText(face.glowing());
  }
}
