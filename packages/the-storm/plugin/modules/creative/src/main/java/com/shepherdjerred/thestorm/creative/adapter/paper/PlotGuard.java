package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.domain.CreativePermissions;
import com.shepherdjerred.thestorm.creative.domain.PlotAccess;
import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMembership;
import com.shepherdjerred.thestorm.creative.domain.PlotMerge;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.Cancellable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.hanging.HangingBreakByEntityEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.vehicle.VehicleDestroyEvent;
import org.bukkit.event.vehicle.VehicleEnterEvent;
import org.bukkit.util.BoundingBox;
import org.jspecify.annotations.Nullable;

/**
 * Plot protection for the creative world. Players change a column only when they own it, are a
 * member, are trusted there, or hold {@link #BYPASS}. A denied player cannot enter that plot or be
 * teleported into it. Visitor actions stay off until the plot's flag is on. A piston, fluid, or
 * explosion that leaves its plot is cancelled whole. A marked plot also refuses an explosion unless
 * its explosion flag is on. Flags do not change world gamerules. Command blocks, structure blocks,
 * jigsaws, and command minecarts cannot be placed.
 */
public final class PlotGuard implements Listener {

  static final String BYPASS = "thestorm.creative.bypass";

  private static final String LABEL = "Creative";
  private static final Component CLOSED = Component.text("You cannot build here.");
  private static final Component BANNED =
      Component.text("That block cannot be placed in creative.");
  private static final Component FULL = Component.text("This plot cannot hold another entity.");
  private static final Component CLOSED_PLOT = Component.text("You cannot enter that plot.");

  private final String worldName;
  private final PlotGrid grid;
  private final PlotMembership membership;
  private final int entityCap;

  public PlotGuard(String worldName, PlotGrid grid, PlotMembership membership, int entityCap) {
    this.worldName = worldName;
    this.grid = grid;
    this.membership = membership;
    this.entityCap = entityCap;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void move(PlayerMoveEvent event) {
    var to = event.getTo();
    if (to == null || !in(to.getWorld())) {
      return;
    }
    var from = event.getFrom();
    if (from.getBlockX() == to.getBlockX() && from.getBlockZ() == to.getBlockZ()) {
      return;
    }
    var player = event.getPlayer();
    if (mayEnter(player, to)) {
      return;
    }
    if (mayEnter(player, from)) {
      event.setCancelled(true);
      return;
    }
    event.setTo(spawn(to.getWorld()));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void teleport(PlayerTeleportEvent event) {
    var to = event.getTo();
    if (to == null || !in(to.getWorld()) || mayEnter(event.getPlayer(), to)) {
      return;
    }
    deny(event, event.getPlayer(), CLOSED_PLOT);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void breakBlock(BlockBreakEvent event) {
    refuse(event, event.getPlayer(), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void place(BlockPlaceEvent event) {
    if (!in(event.getBlock().getWorld())) {
      return;
    }
    var player = event.getPlayer();
    if (forbidden(event.getBlockPlaced().getType())) {
      deny(event, player, BANNED);
      return;
    }
    if (event instanceof BlockMultiPlaceEvent multi) {
      for (var state : multi.getReplacedBlockStates()) {
        if (!allowed(player, state.getX(), state.getZ())) {
          deny(event, player, CLOSED);
          return;
        }
      }
      return;
    }
    refuse(event, player, event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void emptyBucket(PlayerBucketEmptyEvent event) {
    bucket(event);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void fillBucket(PlayerBucketFillEvent event) {
    bucket(event);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void interact(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null || !in(block.getWorld())) {
      return;
    }
    var action = event.getAction();
    if (action != Action.RIGHT_CLICK_BLOCK
        && action != Action.PHYSICAL
        && action != Action.LEFT_CLICK_BLOCK) {
      return;
    }
    if (allowed(event.getPlayer(), block.getX(), block.getZ())) {
      return;
    }
    if (action != Action.LEFT_CLICK_BLOCK && flagOn(block.getLocation(), PlotFlag.USE)) {
      return;
    }
    event.setCancelled(true);
    if (action != Action.LEFT_CLICK_BLOCK) {
      tell(event.getPlayer(), CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void sign(SignChangeEvent event) {
    refuse(event, event.getPlayer(), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void hang(HangingPlaceEvent event) {
    var player = event.getPlayer();
    var entity = event.getEntity();
    if (player == null || !in(entity.getWorld())) {
      return;
    }
    var location = entity.getLocation();
    if (!allowed(player, location.getBlockX(), location.getBlockZ())) {
      deny(event, player, CLOSED);
      return;
    }
    refuseSpawn(event, player, location);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void unhang(HangingBreakByEntityEvent event) {
    if (event.getRemover() instanceof Player player) {
      var location = event.getEntity().getLocation();
      if (in(event.getEntity().getWorld())
          && !allowed(player, location.getBlockX(), location.getBlockZ())) {
        deny(event, player, CLOSED);
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void armorStand(PlayerArmorStandManipulateEvent event) {
    var stand = event.getRightClicked();
    var location = stand.getLocation();
    if (!in(stand.getWorld())) {
      return;
    }
    if (!allowed(event.getPlayer(), location.getBlockX(), location.getBlockZ())) {
      deny(event, event.getPlayer(), CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void useEntity(PlayerInteractEntityEvent event) {
    var entity = event.getRightClicked();
    if (entity instanceof Player || !in(entity.getWorld())) {
      return;
    }
    var location = entity.getLocation();
    if (!allowed(event.getPlayer(), location.getBlockX(), location.getBlockZ())
        && !flagOn(location, PlotFlag.MOB_INTERACT)) {
      deny(event, event.getPlayer(), CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void hurt(EntityDamageByEntityEvent event) {
    if (event.getEntity() instanceof Player victim) {
      guardPvp(event, victim);
      return;
    }
    var attacker = playerFrom(event.getDamager());
    if (attacker == null || !in(event.getEntity().getWorld())) {
      return;
    }
    var location = event.getEntity().getLocation();
    if (!allowed(attacker, location.getBlockX(), location.getBlockZ())) {
      deny(event, attacker, CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void destroyVehicle(VehicleDestroyEvent event) {
    if (!(event.getAttacker() instanceof Player player) || !in(event.getVehicle().getWorld())) {
      return;
    }
    var location = event.getVehicle().getLocation();
    if (!allowed(player, location.getBlockX(), location.getBlockZ())) {
      deny(event, player, CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void enterVehicle(VehicleEnterEvent event) {
    if (!(event.getEntered() instanceof Player player) || !in(event.getVehicle().getWorld())) {
      return;
    }
    var location = event.getVehicle().getLocation();
    if (!allowed(player, location.getBlockX(), location.getBlockZ())
        && !flagOn(location, PlotFlag.VEHICLE)) {
      deny(event, player, CLOSED);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void placeEntity(EntityPlaceEvent event) {
    var player = event.getPlayer();
    var entity = event.getEntity();
    if (player == null || !in(entity.getWorld())) {
      return;
    }
    if (forbidden(entity.getType())) {
      deny(event, player, BANNED);
      return;
    }
    var location = entity.getLocation();
    if (!allowed(player, location.getBlockX(), location.getBlockZ())) {
      deny(event, player, CLOSED);
      return;
    }
    refuseSpawn(event, player, location);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void spawn(CreatureSpawnEvent event) {
    refuseSpawn(event, null, event.getLocation());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void extend(BlockPistonExtendEvent event) {
    piston(event, event.getBlocks(), event.getDirection());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void retract(BlockPistonRetractEvent event) {
    piston(event, event.getBlocks(), event.getDirection().getOppositeFace());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void flow(BlockFromToEvent event) {
    if (!in(event.getBlock().getWorld())) {
      return;
    }
    if (!inside(List.of(column(event.getBlock()), column(event.getToBlock())))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void explode(EntityExplodeEvent event) {
    if (!in(event.getLocation().getWorld())) {
      return;
    }
    var columns = new ArrayList<PlotMerge.Column>();
    columns.add(
        new PlotMerge.Column(event.getLocation().getBlockX(), event.getLocation().getBlockZ()));
    for (var block : event.blockList()) {
      columns.add(column(block));
    }
    containExplosion(
        event, event.getLocation().getBlockX(), event.getLocation().getBlockZ(), columns);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void explodeBlock(BlockExplodeEvent event) {
    if (!in(event.getBlock().getWorld())) {
      return;
    }
    var columns = new ArrayList<PlotMerge.Column>();
    columns.add(column(event.getBlock()));
    for (var block : event.blockList()) {
      columns.add(column(block));
    }
    containExplosion(event, event.getBlock().getX(), event.getBlock().getZ(), columns);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void changeBlock(EntityChangeBlockEvent event) {
    if (!in(event.getBlock().getWorld())) {
      return;
    }
    if (!inside(List.of(column(event.getBlock())))) {
      event.setCancelled(true);
    }
  }

  private void bucket(PlayerBucketEvent event) {
    var clicked = event.getBlockClicked();
    if (!in(clicked.getWorld())) {
      return;
    }
    var target = clicked.getRelative(event.getBlockFace());
    var player = event.getPlayer();
    if (allowed(player, clicked.getX(), clicked.getZ())
        && allowed(player, target.getX(), target.getZ())) {
      return;
    }
    deny(event, player, CLOSED);
  }

  /**
   * {@code travel} is the direction the moved blocks travel. Paper's facing is that direction while
   * extending and the opposite while retracting. The head occupies the cell one block along the
   * facing.
   */
  private void piston(BlockPistonEvent event, List<Block> blocks, BlockFace travel) {
    if (!in(event.getBlock().getWorld())) {
      return;
    }
    var columns = new ArrayList<PlotMerge.Column>();
    columns.add(column(event.getBlock()));
    columns.add(column(event.getBlock().getRelative(event.getDirection())));
    for (var block : blocks) {
      columns.add(column(block));
      columns.add(column(block.getRelative(travel)));
    }
    if (!inside(columns)) {
      event.setCancelled(true);
    }
  }

  private void refuse(Cancellable event, Player player, Block block) {
    if (in(block.getWorld()) && !allowed(player, block.getX(), block.getZ())) {
      deny(event, player, CLOSED);
    }
  }

  private void refuseSpawn(Cancellable event, @Nullable Player player, Location at) {
    var world = at.getWorld();
    if (world == null) {
      return;
    }
    var staff = player != null && player.hasPermission(BYPASS);
    if (!spawnRefused(world, at.getBlockX(), at.getBlockZ(), staff)) {
      return;
    }
    event.setCancelled(true);
    if (player != null) {
      tell(player, FULL);
    }
  }

  private boolean spawnRefused(World world, int x, int z, boolean staff) {
    if (!in(world)) {
      return false;
    }
    var plot = grid.plotAt(x, z);
    var present = staff || plot.isEmpty() ? 0 : count(world, plot.orElseThrow());
    return !PlotAccess.maySpawn(staff, plot, present, entityCap);
  }

  private int count(World world, PlotId id) {
    var bounds = grid.bounds(id);
    var box =
        new BoundingBox(
            bounds.minX(),
            world.getMinHeight(),
            bounds.minZ(),
            bounds.maxX() + 1.0,
            world.getMaxHeight(),
            bounds.maxZ() + 1.0);
    var present = 0;
    for (var entity : world.getNearbyEntities(box)) {
      if (entity instanceof Player) {
        continue;
      }
      var column = grid.plotAt(entity.getLocation().getBlockX(), entity.getLocation().getBlockZ());
      if (column.isPresent() && column.orElseThrow().equals(id)) {
        present++;
      }
    }
    return present;
  }

  private void guardPvp(EntityDamageByEntityEvent event, Player victim) {
    if (!in(victim.getWorld())) {
      return;
    }
    var attacker = playerFrom(event.getDamager());
    if (attacker == null) {
      return;
    }
    var location = victim.getLocation();
    if (location == null || allowed(attacker, location.getBlockX(), location.getBlockZ())) {
      return;
    }
    var plot = grid.plotAt(location.getBlockX(), location.getBlockZ());
    if (plot.isEmpty() || flagOn(location, PlotFlag.PVP)) {
      return;
    }
    deny(event, attacker, CLOSED);
  }

  private void containExplosion(Cancellable event, int x, int z, List<PlotMerge.Column> columns) {
    if (!inside(columns)) {
      event.setCancelled(true);
      return;
    }
    var group = PlotMerge.clusterAt(grid, new PlotMerge.Column(x, z), membership.clusters());
    if (group.isEmpty()) {
      return;
    }
    var id = group.getFirst();
    if (!PlotFlag.explosionMay(true, membership.marked(id), membership.flags(id))) {
      event.setCancelled(true);
    }
  }

  private boolean inside(List<PlotMerge.Column> columns) {
    return PlotMerge.contained(grid, columns, membership.clusters());
  }

  private static PlotMerge.Column column(Block block) {
    return new PlotMerge.Column(block.getX(), block.getZ());
  }

  private boolean flagOn(Location at, PlotFlag flag) {
    var plot = grid.plotAt(at.getBlockX(), at.getBlockZ());
    return plot.isPresent() && membership.flags(plot.orElseThrow()).contains(flag);
  }

  private boolean mayEnter(Player player, Location at) {
    var plot = grid.plotAt(at.getBlockX(), at.getBlockZ());
    if (plot.isEmpty()) {
      return true;
    }
    var staff = player.hasPermission(BYPASS) || player.hasPermission(CreativePermissions.ADMIN);
    return PlotRole.mayEnter(staff, membership.access(plot.orElseThrow()), player.getUniqueId());
  }

  private static Location spawn(World world) {
    return new Location(world, PlotGrid.SPAWN_X + 0.5, PlotGrid.SPAWN_Y, PlotGrid.SPAWN_Z + 0.5);
  }

  private boolean allowed(Player player, int x, int z) {
    var staff = player.hasPermission(BYPASS);
    var plot = grid.plotAt(x, z);
    if (PlotAccess.mayChange(staff, Optional.of(player.getUniqueId()), plot, membership)) {
      return true;
    }
    if (staff || plot.isPresent()) {
      return false;
    }
    return PlotMerge.buildsOnRoad(
        grid, new PlotMerge.Column(x, z), player.getUniqueId(), membership);
  }

  private boolean forbidden(Material type) {
    return PlotAccess.forbiddenPlacement(type.getKey().asString());
  }

  private boolean forbidden(EntityType type) {
    return PlotAccess.forbiddenPlacement(type.getKey().asString());
  }

  private void deny(Cancellable event, Player player, Component message) {
    event.setCancelled(true);
    tell(player, message);
  }

  private void tell(Player player, Component message) {
    player.sendMessage(HouseStyle.error(LABEL, message));
  }

  private boolean in(@Nullable World world) {
    return world != null && worldName.equals(world.getName());
  }

  private @Nullable Player playerFrom(Entity entity) {
    if (entity instanceof Player player) {
      return player;
    }
    if (entity instanceof Projectile projectile
        && projectile.getShooter() instanceof Player player) {
      return player;
    }
    return null;
  }
}
