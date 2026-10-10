package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.UUID;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockRedstoneEvent;
import org.bukkit.event.player.PlayerInteractEvent;

/** Actual door occlusion after normal interaction, including ordinary redstone changes. */
final class DoorVisibility implements Listener, AutoCloseable {
  private final World world;
  private final Scheduler scheduler;
  private final Roster roster;
  private final ThinkLoop loop;
  private final NavCatalog catalog;
  private boolean closed;

  record Parts(
      World world, Scheduler scheduler, Roster roster, ThinkLoop loop, NavCatalog catalog) {}

  DoorVisibility(Parts parts) {
    this.world = parts.world();
    this.scheduler = parts.scheduler();
    this.roster = parts.roster();
    this.loop = parts.loop();
    this.catalog = parts.catalog();
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void interact(PlayerInteractEvent event) {
    if (event.useInteractedBlock() == Event.Result.DENY) return;
    var block = event.getClickedBlock();
    if (block != null) schedule(block);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void redstone(BlockRedstoneEvent event) {
    if (event.getOldCurrent() == event.getNewCurrent()) return;
    var block = event.getBlock();
    schedule(block);
    for (var face :
        new BlockFace[] {
          BlockFace.NORTH,
          BlockFace.SOUTH,
          BlockFace.EAST,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN
        }) schedule(block.getRelative(face));
  }

  private void schedule(Block block) {
    if (closed || !block.getWorld().equals(world) || !Tag.WOODEN_DOORS.isTagged(block.getType()))
      return;
    var session = roster.session();
    if (session.isEmpty()) return;
    var owner = session.orElseThrow().matchId();
    scheduler.runOnMainThread(() -> observe(owner, block));
  }

  private void observe(UUID owner, Block block) {
    if (closed) return;
    var current = roster.session().filter(match -> match.matchId().equals(owner));
    if (current.isEmpty() || !(block.getBlockData() instanceof Door door)) return;
    var lower = door.getHalf() == Bisected.Half.BOTTOM ? block : block.getRelative(BlockFace.DOWN);
    var position = new BlockPos(lower.getX(), lower.getY(), lower.getZ());
    var match = current.orElseThrow();
    if (!match.nav().grid().bounds().contains(position)
        || !match.nav().grid().bounds().contains(position.up())) return;
    var grid = match.nav().grid();
    if (grid.blocks(position, com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid.Layer.SIGHT)
        == !door.isOpen()) return;
    var next = match.nav().withGrid(grid.withDoorState(position, door.isOpen()));
    catalog.observed(next);
    roster.session(
        new MatchSession(match.matchId(), match.seed(), next, match.ids(), match.capture()));
    loop.observedNavigation(next);
  }

  @Override
  public void close() {
    closed = true;
    HandlerList.unregisterAll(this);
  }
}
