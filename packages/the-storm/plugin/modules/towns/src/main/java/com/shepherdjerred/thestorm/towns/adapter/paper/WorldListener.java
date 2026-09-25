package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import io.papermc.paper.event.entity.ItemTransportingEntityValidateTargetEvent;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.block.data.Directional;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockFertilizeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockRedstoneEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.block.SpongeAbsorbEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.world.PortalCreateEvent;
import org.bukkit.event.world.StructureGrowEvent;

/**
 * Things the world does across claim borders: pistons, fluids, hoppers and other item moves, copper
 * golems, dispensers, sponges, growth, bone meal and spreading blocks. Fluid flow and item moves
 * fire constantly, so they cost two in-memory land lookups and nothing else.
 */
final class WorldListener implements Listener {

  private final Guard guard;
  private final BlockKinds kinds;
  private final Redstone redstone;

  WorldListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
    this.redstone = new Redstone(guard, kinds);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFlow(BlockFromToEvent event) {
    if (!guard.flows(WorldEffect.FLUID_FLOW, event.getBlock(), event.getToBlock())) {
      event.setCancelled(true);
    }
  }

  /**
   * Items move only within one owner's land. Both halves of a double chest count, so a hopper under
   * the wild half of a chest that straddles a border cannot drain the claimed half.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onItemMove(InventoryMoveItemEvent event) {
    // An inventory with no place in the world, such as a plugin's menu, has no land and no halves.
    for (var from : Chests.locations(event.getSource())) {
      for (var to : Chests.locations(event.getDestination())) {
        if (!Guard.flows(WorldEffect.ITEM_TRANSFER, guard.land(from), guard.land(to))) {
          event.setCancelled(true);
          return;
        }
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW)
  void onCopperGolemTarget(ItemTransportingEntityValidateTargetEvent event) {
    var golem = guard.land(Origins.of(event.getEntity()));
    var target = event.getBlock();
    var blocked =
        !Guard.flows(WorldEffect.ITEM_TRANSFER, golem, guard.land(target))
            || Chests.partner(target)
                .filter(half -> !Guard.flows(WorldEffect.ITEM_TRANSFER, golem, guard.land(half)))
                .isPresent();
    if (blocked) {
      event.setAllowed(false);
    }
  }

  /**
   * Redstone from another owner's land cannot open a door, trapdoor or fence gate: a torch in the
   * wild beside a town's door, or beside a block next to it, would otherwise open it.
   */
  @EventHandler(priority = EventPriority.LOW)
  void onRedstone(BlockRedstoneEvent event) {
    if (event.getNewCurrent() <= event.getOldCurrent()) {
      return;
    }
    var block = event.getBlock();
    if (kinds.opensWithRedstone(block.getType()) && redstone.foreignPower(block)) {
      event.setNewCurrent(event.getOldCurrent());
    }
  }

  /**
   * A portal generated in claimed land needs the arriving player to be allowed to build there;
   * portals nobody is behind are never generated inside claims or regions.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPortal(PortalCreateEvent event) {
    var blocks = event.getBlocks();
    if (blocks.isEmpty()) {
      return;
    }
    var entity = event.getEntity();
    var player = guard.culprit(entity);
    var from = entity != null ? guard.land(entity) : guard.land(blocks.getFirst());
    var build = new Act(Action.BUILD, Subject.BLOCK);
    for (var block : blocks) {
      var land = guard.land(block);
      var allowed =
          player.isPresent()
              ? guard.permitsQuietly(player.get(), build, land)
              : Guard.flows(WorldEffect.PORTAL_CREATION, from, land);
      if (!allowed) {
        event.setCancelled(true);
        return;
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    var piston = event.getBlock();
    var direction = event.getDirection();
    var moved = new ArrayList<Block>(event.getBlocks());
    moved.add(piston.getRelative(direction));
    if (redstone.foreignPistonPower(piston) || !pistonMay(guard.land(piston), moved, direction)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    var from = guard.land(event.getBlock());
    var direction = event.getDirection();
    if (redstone.foreignPistonPower(event.getBlock())
        || !pistonMay(from, event.getBlocks(), direction)
        || !pistonMay(from, event.getBlocks(), direction.getOppositeFace())) {
      event.setCancelled(true);
    }
  }

  /** Every moved block must be allowed both where it is and where it goes. */
  private boolean pistonMay(Land from, List<Block> blocks, BlockFace direction) {
    for (var block : blocks) {
      if (!Guard.flows(WorldEffect.PISTON, from, guard.land(block))
          || !Guard.flows(WorldEffect.PISTON, from, guard.land(block.getRelative(direction)))) {
        return false;
      }
    }
    return true;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDispense(BlockDispenseEvent event) {
    var dispenser = event.getBlock();
    if (dispenser.getBlockData() instanceof Directional directional
        && !guard.flows(
            WorldEffect.DISPENSE, dispenser, dispenser.getRelative(directional.getFacing()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSponge(SpongeAbsorbEvent event) {
    var from = guard.land(event.getBlock());
    event
        .getBlocks()
        .removeIf(water -> !Guard.flows(WorldEffect.FLUID_FLOW, from, guard.land(water)));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onGrow(StructureGrowEvent event) {
    var from = guard.land(event.getLocation());
    var player = event.getPlayer();
    if (player != null && !guard.permits(player, new Act(Action.BUILD, Subject.BLOCK), from)) {
      event.setCancelled(true);
      return;
    }
    keepAllowed(event.getBlocks(), WorldEffect.TREE_GROWTH, from);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFertilize(BlockFertilizeEvent event) {
    var from = guard.land(event.getBlock());
    var player = event.getPlayer();
    if (player != null && !guard.permits(player, new Act(Action.BUILD, Subject.BLOCK), from)) {
      event.setCancelled(true);
      return;
    }
    keepAllowed(event.getBlocks(), WorldEffect.BONEMEAL_SPREAD, from);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSpread(BlockSpreadEvent event) {
    var effect = spreadOf(event.getNewState().getType());
    if (!guard.flows(effect, event.getSource(), event.getBlock())) {
      event.setCancelled(true);
    }
  }

  private void keepAllowed(List<BlockState> blocks, WorldEffect effect, Land from) {
    blocks.removeIf(block -> !Guard.flows(effect, from, guard.land(block)));
  }

  private static WorldEffect spreadOf(Material type) {
    return switch (type) {
      case FIRE, SOUL_FIRE -> WorldEffect.FIRE_SPREAD;
      case SCULK, SCULK_VEIN, SCULK_SENSOR, SCULK_SHRIEKER, SCULK_CATALYST ->
          WorldEffect.SCULK_SPREAD;
      default -> WorldEffect.BLOCK_SPREAD;
    };
  }
}
