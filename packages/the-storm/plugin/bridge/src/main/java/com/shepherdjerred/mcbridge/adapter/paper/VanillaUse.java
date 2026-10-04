package com.shepherdjerred.mcbridge.adapter.paper;

import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Openable;
import org.bukkit.block.data.Powerable;
import org.bukkit.block.data.type.Door;
import org.bukkit.block.data.type.Switch;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/**
 * The vanilla right-click result for the few blocks an actor's {@code use} can simulate through the
 * Bukkit API: wooden doors (both halves), wooden trapdoors, fence gates, levers and buttons. Iron
 * doors and trapdoors need redstone, as in vanilla. Anything else (containers, beds, signs,
 * crafting tables) is left to plugins listening for the interact event.
 */
public final class VanillaUse {
  private VanillaUse() {}

  /**
   * Applies the vanilla result, or returns null when this block has none the bridge simulates.
   *
   * @return a short description of what changed
   */
  public static @Nullable String apply(Plugin plugin, Block block, long buttonTicks) {
    BlockData data = block.getBlockData();
    Material type = block.getType();
    if (Tag.BUTTONS.isTagged(type) && data instanceof Switch button) {
      if (button.isPowered()) {
        return "button already pressed";
      }
      button.setPowered(true);
      block.setBlockData(button, true);
      plugin
          .getServer()
          .getScheduler()
          .runTaskLater(plugin, () -> release(block, type), buttonTicks);
      return "pressed button for " + buttonTicks + " ticks";
    }
    if (type == Material.LEVER && data instanceof Powerable lever) {
      lever.setPowered(!lever.isPowered());
      block.setBlockData(lever, true);
      return "lever powered=" + lever.isPowered();
    }
    if (type == Material.IRON_DOOR || type == Material.IRON_TRAPDOOR) {
      return null;
    }
    if (data instanceof Door door) {
      boolean open = !door.isOpen();
      setOpen(block, door, open);
      Block other =
          block.getRelative(door.getHalf() == Bisected.Half.BOTTOM ? BlockFace.UP : BlockFace.DOWN);
      if (other.getBlockData() instanceof Door half) {
        setOpen(other, half, open);
      }
      return "door open=" + open;
    }
    if (data instanceof Openable openable) {
      boolean open = !openable.isOpen();
      setOpen(block, openable, open);
      return "open=" + open;
    }
    return null;
  }

  private static void setOpen(Block block, Openable openable, boolean open) {
    openable.setOpen(open);
    block.setBlockData(openable, true);
  }

  private static void release(Block block, Material type) {
    if (block.getType() == type && block.getBlockData() instanceof Switch button) {
      button.setPowered(false);
      block.setBlockData(button, true);
    }
  }
}
