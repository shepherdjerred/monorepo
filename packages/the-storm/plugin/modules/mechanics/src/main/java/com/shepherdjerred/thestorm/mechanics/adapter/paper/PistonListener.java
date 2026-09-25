package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import com.shepherdjerred.thestorm.mechanics.domain.piston.PistonRules;
import com.shepherdjerred.thestorm.mechanics.domain.piston.Velocity;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.time.Duration;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.Directional;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.util.BoundingBox;
import org.bukkit.util.Vector;

/**
 * Special pistons, configured by a sign touching the piston. Each acts with its sign creator's land
 * rights and never touches blacklisted blocks, block entities or unbreakable blocks.
 *
 * <ul>
 *   <li>{@code [Crush]}: instead of pushing, breaks the block in front (it drops as if mined); the
 *       still-powered piston then extends into the gap.
 *   <li>{@code [Bounce]}: launches entities in front of the head.
 *   <li>{@code [SuperPush]}: once extended, pushes the line in front of the head further.
 *   <li>{@code [SuperSticky]}: once retracted, pulls the blocks in front of it in, closing gaps.
 * </ul>
 */
final class PistonListener implements Listener {

  private static final List<BlockFace> FACES =
      List.of(
          BlockFace.NORTH,
          BlockFace.EAST,
          BlockFace.SOUTH,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN);

  /** Long enough for vanilla's piston animation (two ticks) to finish. */
  private static final Duration SETTLE = Duration.ofMillis(150);

  private final Kit kit;
  private final PistonRules rules;

  PistonListener(Kit kit) {
    this.kit = kit;
    this.rules = new PistonRules(kit.config().pistons().refused());
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onExtend(BlockPistonExtendEvent event) {
    var piston = event.getBlock();
    var signs = signs(piston);
    if (signs.isEmpty()) {
      return;
    }
    var facing = facing(piston);
    var head = piston.getRelative(facing);
    var crusher = signs.get(Mechanism.CRUSH);
    if (crusher != null && crush(crusher, head)) {
      event.setCancelled(true);
      return;
    }
    if (signs.containsKey(Mechanism.BOUNCE)) {
      bounce(head, facing);
    }
    var pusher = signs.get(Mechanism.SUPER_PUSH);
    if (pusher != null) {
      settleThen(piston, pusher, grid -> push(grid, piston, facing));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onRetract(BlockPistonRetractEvent event) {
    var piston = event.getBlock();
    if (!event.isSticky()) {
      return;
    }
    var puller = signs(piston).get(Mechanism.SUPER_STICKY);
    if (puller != null) {
      var facing = facing(piston);
      settleThen(piston, puller, grid -> pull(grid, piston, facing));
    }
  }

  private boolean crush(UUID owner, Block head) {
    var grid = new PaperGrid(head.getWorld());
    var pos = PaperGrid.pos(head);
    if (!rules.crushable(grid.cellAt(pos))
        || !kit.guard().check(owner, ProtectedAction.BREAK, grid, pos).isAllowed()) {
      return false;
    }
    head.breakNaturally();
    return true;
  }

  private void bounce(Block head, BlockFace facing) {
    var direction = PaperGrid.direction(facing);
    var launch = Velocity.toward(direction.orElseThrow(), kit.config().pistons().bounceForce());
    var box = BoundingBox.of(head).expand(facing, 1.0);
    for (var entity : head.getWorld().getNearbyEntities(box)) {
      entity.setVelocity(entity.getVelocity().add(new Vector(launch.x(), launch.y(), launch.z())));
    }
  }

  private List<BlockMove> push(PaperGrid grid, Block piston, BlockFace facing) {
    var config = kit.config().pistons();
    return rules.push(
        grid,
        PaperGrid.pos(piston),
        PaperGrid.direction(facing).orElseThrow(),
        new PistonRules.Reach(config.pushDistance(), config.maxBlocks()));
  }

  private List<BlockMove> pull(PaperGrid grid, Block piston, BlockFace facing) {
    var config = kit.config().pistons();
    return rules.pull(
        grid,
        PaperGrid.pos(piston),
        PaperGrid.direction(facing).orElseThrow(),
        new PistonRules.Reach(config.stickyReach(), config.maxBlocks()));
  }

  /** After the piston settles, plans moves and applies them if the owner may make every one. */
  private void settleThen(Block piston, UUID owner, Function<PaperGrid, List<BlockMove>> planner) {
    var type = piston.getType();
    kit.scheduler()
        .runOnMainThreadLater(
            SETTLE,
            () -> {
              if (piston.getType() != type) {
                return;
              }
              var grid = new PaperGrid(piston.getWorld());
              var moves = planner.apply(grid);
              if (!moves.isEmpty() && kit.guard().moves(owner, grid, moves).isAllowed()) {
                Placer.move(grid, moves);
              }
            });
  }

  /** The switched-on piston signs touching {@code piston}, each with its creator. */
  private Map<Mechanism, UUID> signs(Block piston) {
    var found = new EnumMap<Mechanism, UUID>(Mechanism.class);
    for (var face : FACES) {
      var block = piston.getRelative(face);
      if (!Signs.isSign(block.getType()) || !(block.getState(false) instanceof Sign sign)) {
        continue;
      }
      var mechanism = PaperGrid.view(block, PaperGrid.frontLines(sign)).mechanism();
      var owner = kit.signs().owner(sign);
      if (mechanism.isPresent()
          && mechanism.orElseThrow().isPiston()
          && owner.isPresent()
          && kit.gatekeeper().enabled(mechanism.orElseThrow().feature())) {
        found.putIfAbsent(mechanism.orElseThrow(), owner.orElseThrow());
      }
    }
    return found;
  }

  private static BlockFace facing(Block piston) {
    if (piston.getBlockData() instanceof Directional directional) {
      return directional.getFacing();
    }
    throw new IllegalStateException("a piston without a facing: " + piston.getBlockData());
  }
}
