package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.mail.app.MailItem;
import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import com.sk89q.worldedit.util.SideEffect;
import com.sk89q.worldedit.util.SideEffectSet;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Chest;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Bed;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Painting;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/** Finite, bounded world work on Paper's main thread. Schematics preserve full block/entity NBT. */
final class PlotWorld {
  private static final int BLOCKS_PER_TICK = 1024;
  private static final Set<String> DECOR =
      Set.of(
          "minecraft:item_frame",
          "minecraft:glow_item_frame",
          "minecraft:painting",
          "minecraft:armor_stand",
          "minecraft:text_display",
          "minecraft:item_display",
          "minecraft:block_display",
          "minecraft:mannequin");
  private final ModuleContext context;

  record Captured(Clipboard clipboard, List<MailItem> materials) {
    Captured {
      materials = List.copyOf(materials);
    }
  }

  PlotWorld(ModuleContext context) {
    this.context = context;
  }

  CompletableFuture<Captured> capture(Cuboid area) {
    var world = world(area.world());
    var extent = BukkitAdapter.adapt(world);
    var region = region(area);
    var clipboard = new BlockArrayClipboard(region);
    clipboard.setOrigin(region.getMinimumPoint());
    var materials = new ArrayList<MailItem>();
    var completion = new CompletableFuture<Captured>();
    captureBatch(
        new CaptureWork(region.iterator(), extent, world, clipboard, materials, completion));
    return completion;
  }

  private record CaptureWork(
      Iterator<BlockVector3> blocks,
      com.sk89q.worldedit.world.World extent,
      World world,
      Clipboard clipboard,
      List<MailItem> materials,
      CompletableFuture<Captured> completion) {}

  private void captureBatch(CaptureWork work) {
    try {
      var count = 0;
      while (work.blocks().hasNext() && count++ < BLOCKS_PER_TICK) {
        var pos = work.blocks().next();
        var full = work.extent().getFullBlock(pos);
        var nbt = full.getNbtReference();
        if (nbt != null) {
          var _ = nbt.getValue();
        }
        work.clipboard().setBlock(pos, full);
        materials(work.world().getBlockAt(pos.x(), pos.y(), pos.z()), work.materials());
      }
      if (work.blocks().hasNext()) {
        context.scheduler().runOnMainThreadLater(Duration.ofMillis(50), () -> captureBatch(work));
      } else {
        captureDecor(work);
        work.completion().complete(new Captured(work.clipboard(), work.materials()));
      }
    } catch (RuntimeException | WorldEditException e) {
      work.completion().completeExceptionally(e);
    }
  }

  private static void captureDecor(CaptureWork work) {
    for (var entity : work.extent().getEntities(work.clipboard().getRegion())) {
      var state = entity.getState();
      if (state != null && DECOR.contains(state.getType().id())) {
        var nbt = state.getNbtReference();
        if (nbt != null) {
          var _ = nbt.getValue();
        }
        work.clipboard().createEntity(entity.getLocation(), state);
      }
    }
    var box =
        new org.bukkit.util.BoundingBox(
            work.clipboard().getMinimumPoint().x(),
            work.clipboard().getMinimumPoint().y(),
            work.clipboard().getMinimumPoint().z(),
            work.clipboard().getMaximumPoint().x() + 1.0,
            work.clipboard().getMaximumPoint().y() + 1.0,
            work.clipboard().getMaximumPoint().z() + 1.0);
    for (var entity : work.world().getNearbyEntities(box)) {
      if (box.contains(entity.getLocation().toVector())) {
        decorationMaterials(entity, work.materials());
      }
    }
  }

  private static void decorationMaterials(
      org.bukkit.entity.Entity entity, List<MailItem> materials) {
    if (entity instanceof ItemFrame frame) {
      add(
          new ItemStack(
              frame instanceof org.bukkit.entity.GlowItemFrame
                  ? Material.GLOW_ITEM_FRAME
                  : Material.ITEM_FRAME),
          materials);
      add(frame.getItem(), materials);
    } else if (entity instanceof Painting) {
      add(new ItemStack(Material.PAINTING), materials);
    } else if (entity instanceof ArmorStand stand) {
      add(new ItemStack(Material.ARMOR_STAND), materials);
      var equipment = stand.getEquipment();
      if (equipment != null) {
        for (var slot :
            List.of(
                org.bukkit.inventory.EquipmentSlot.HAND,
                org.bukkit.inventory.EquipmentSlot.OFF_HAND,
                org.bukkit.inventory.EquipmentSlot.HEAD,
                org.bukkit.inventory.EquipmentSlot.CHEST,
                org.bukkit.inventory.EquipmentSlot.LEGS,
                org.bukkit.inventory.EquipmentSlot.FEET)) {
          add(equipment.getItem(slot), materials);
        }
      }
    }
  }

  private static void materials(org.bukkit.block.Block block, List<MailItem> items) {
    var type = block.getType();
    if (type.isAir()) {
      return;
    }
    var data = block.getBlockData();
    var upper =
        data instanceof Bisected bisected
            && bisected.getHalf() == Bisected.Half.TOP
            && (Tag.DOORS.isTagged(type)
                || Set.of(
                        Material.SUNFLOWER,
                        Material.LILAC,
                        Material.ROSE_BUSH,
                        Material.PEONY,
                        Material.TALL_GRASS,
                        Material.LARGE_FERN,
                        Material.TALL_SEAGRASS,
                        Material.PITCHER_PLANT)
                    .contains(type));
    var bedHead = data instanceof Bed bed && bed.getPart() == Bed.Part.HEAD;
    var blockType = java.util.Objects.requireNonNull(type.asBlockType());
    if (blockType.hasItemType() && !upper && !bedHead) {
      add(blockType.getItemType().createItemStack(materialCount(data)), items);
    }
    var state = block.getState();
    if (state instanceof InventoryHolder holder) {
      var inventory =
          state instanceof Chest chest ? chest.getBlockInventory() : holder.getInventory();
      new ArrayList<>(inventory.getViewers())
          .forEach(org.bukkit.entity.HumanEntity::closeInventory);
      for (var slot = 0; slot < inventory.getSize(); slot++) {
        var item = inventory.getItem(slot);
        if (item != null) {
          add(item, items);
        }
      }
    }
  }

  private static void add(ItemStack item, List<MailItem> items) {
    if (!item.isEmpty()) {
      items.add(new MailItem(item.serializeAsBytes()));
    }
  }

  private static int materialCount(org.bukkit.block.data.BlockData data) {
    if (data instanceof org.bukkit.block.data.type.Slab slab
        && slab.getType() == org.bukkit.block.data.type.Slab.Type.DOUBLE) {
      return 2;
    }
    if (data instanceof org.bukkit.block.data.type.Candle candle) {
      return candle.getCandles();
    }
    if (data instanceof org.bukkit.block.data.type.SeaPickle pickles) {
      return pickles.getPickles();
    }
    if (data instanceof org.bukkit.block.data.type.TurtleEgg eggs) {
      return eggs.getEggs();
    }
    return 1;
  }

  CompletableFuture<Void> paste(Clipboard clipboard, String worldName, BlockVector3 origin) {
    return paste(clipboard, worldName, origin, pos -> true);
  }

  CompletableFuture<Void> paste(
      Clipboard clipboard,
      String worldName,
      BlockVector3 origin,
      Predicate<BlockVector3> permitted) {
    var world = world(worldName);
    var completion = new CompletableFuture<Void>();
    var offset = origin.subtract(clipboard.getOrigin());
    pasteBatch(
        new PasteWork(
            clipboard.getRegion().iterator(),
            clipboard,
            BukkitAdapter.adapt(world),
            offset,
            world,
            permitted,
            completion));
    return completion;
  }

  private record PasteWork(
      Iterator<BlockVector3> blocks,
      Clipboard clipboard,
      com.sk89q.worldedit.world.World extent,
      BlockVector3 offset,
      World world,
      Predicate<BlockVector3> permitted,
      CompletableFuture<Void> completion) {}

  private void pasteBatch(PasteWork work) {
    try {
      requireClearActors(work.world(), work.clipboard().getRegion(), work.offset());
      var count = 0;
      while (work.blocks().hasNext() && count++ < BLOCKS_PER_TICK) {
        var source = work.blocks().next();
        if (!work.permitted().test(source.add(work.offset()))) {
          throw new IllegalStateException("building permission changed during placement");
        }
        work.extent()
            .setBlock(
                source.add(work.offset()),
                work.clipboard().getFullBlock(source),
                SideEffectSet.defaults()
                    .with(SideEffect.NEIGHBORS, SideEffect.State.OFF)
                    .with(SideEffect.EVENTS, SideEffect.State.OFF));
      }
      if (work.blocks().hasNext()) {
        context.scheduler().runOnMainThreadLater(Duration.ofMillis(50), () -> pasteBatch(work));
      } else {
        pasteDecor(work);
        work.world().save();
        work.completion().complete(null);
      }
    } catch (RuntimeException | WorldEditException e) {
      work.completion().completeExceptionally(e);
    }
  }

  private static void pasteDecor(PasteWork work) throws WorldEditException {
    var copier =
        new com.sk89q.worldedit.function.entity.ExtentEntityCopy(
            work.clipboard().getOrigin().toVector3(),
            work.extent(),
            work.clipboard().getOrigin().add(work.offset()).toVector3(),
            new com.sk89q.worldedit.math.transform.AffineTransform());
    for (var entity : work.clipboard().getEntities()) {
      var state = entity.getState();
      if (state == null || !DECOR.contains(state.getType().id())) {
        throw new IllegalStateException("shop schematic contains a non-decoration entity");
      }
      if (!work.permitted()
          .test(entity.getLocation().toVector().toBlockPoint().add(work.offset()))) {
        throw new IllegalStateException("decoration permission changed during placement");
      }
      if (!copier.apply(entity)) {
        throw new IllegalStateException("shop decoration could not be recreated");
      }
    }
  }

  World world(String name) {
    var world = context.plugin().getServer().getWorld(name);
    if (world == null) {
      throw new IllegalStateException("plot world is not loaded: " + name);
    }
    return world;
  }

  private static void requireClearActors(
      World world, com.sk89q.worldedit.regions.Region region, BlockVector3 offset) {
    var min = region.getMinimumPoint().add(offset);
    var max = region.getMaximumPoint().add(offset);
    var box =
        new org.bukkit.util.BoundingBox(
            min.x(), min.y(), min.z(), max.x() + 1.0, max.y() + 1.0, max.z() + 1.0);
    if (world.getNearbyEntities(box).stream()
        .anyMatch(entity -> !DECOR.contains(entity.getType().getKey().toString()))) {
      throw new IllegalStateException(
          "move players, animals and loose items out of the pending shop volume before reconciliation");
    }
  }

  void clearDecor(Cuboid area) {
    var box =
        new org.bukkit.util.BoundingBox(
            area.from().x(),
            area.from().y(),
            area.from().z(),
            area.to().x() + 1.0,
            area.to().y() + 1.0,
            area.to().z() + 1.0);
    for (var entity : world(area.world()).getNearbyEntities(box)) {
      if (box.contains(entity.getLocation().toVector())
          && DECOR.contains(entity.getType().getKey().toString())) {
        entity.remove();
      }
    }
  }

  CompletableFuture<Void> verify(Clipboard clipboard, String worldName, BlockVector3 origin) {
    var completion = new CompletableFuture<Void>();
    verifyBatch(
        new VerifyWork(
            clipboard.getRegion().iterator(),
            clipboard,
            BukkitAdapter.adapt(world(worldName)),
            origin.subtract(clipboard.getOrigin()),
            completion));
    return completion;
  }

  private record VerifyWork(
      Iterator<BlockVector3> blocks,
      Clipboard clipboard,
      com.sk89q.worldedit.world.World extent,
      BlockVector3 offset,
      CompletableFuture<Void> completion) {}

  private void verifyBatch(VerifyWork work) {
    try {
      var count = 0;
      while (work.blocks().hasNext() && count++ < BLOCKS_PER_TICK) {
        var source = work.blocks().next();
        var expected = work.clipboard().getFullBlock(source);
        var actual = work.extent().getFullBlock(source.add(work.offset()));
        if (!expected.toImmutableState().equals(actual.toImmutableState())
            || !blockNbt(expected).equals(blockNbt(actual))) {
          throw new IllegalStateException(
              "recovered block did not verify at " + source.add(work.offset()));
        }
      }
      if (work.blocks().hasNext()) {
        context.scheduler().runOnMainThreadLater(Duration.ofMillis(50), () -> verifyBatch(work));
      } else {
        work.completion().complete(null);
      }
    } catch (RuntimeException e) {
      work.completion().completeExceptionally(e);
    }
  }

  private static java.util.Map<String, org.enginehub.linbus.tree.LinTag<?>> blockNbt(
      com.sk89q.worldedit.world.block.BaseBlock block) {
    var ref = block.getNbtReference();
    if (ref == null) {
      return java.util.Map.of();
    }
    var values = new java.util.HashMap<>(ref.getValue().value());
    // WorldEdit rewrites absolute block-entity coordinates at the destination.
    values
        .keySet()
        .removeAll(
            Set.of(
                "x", "y", "z", "BurnTime", "CookTime", "CookingTimeSpent", "lit_time_remaining"));
    return values;
  }

  static CuboidRegion region(Cuboid area) {
    return new CuboidRegion(
        BlockVector3.at(area.from().x(), area.from().y(), area.from().z()),
        BlockVector3.at(area.to().x(), area.to().y(), area.to().z()));
  }
}
