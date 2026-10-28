package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAccess;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.lock.LockType;
import com.shepherdjerred.thestorm.towns.domain.town.TownRules;
import io.papermc.paper.event.entity.ItemTransportingEntityValidateTargetEvent;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.block.Block;
import org.bukkit.block.data.Openable;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Locked containers, on any land: only their owner, the players they trust and (by config) their
 * town mates open or break them; items move in or out only between ends one owner locked;
 * explosions, pistons, fire and mobs never destroy them; nobody else places a container, hopper or
 * redstone where it would reach into them. A lock follows its blocks: breaking one releases it, and
 * a double chest its owner completes is locked whole.
 */
final class LockListener implements Listener {

  /** How far (Manhattan) a redstone component can reach a dispenser, dropper or crafter. */
  private static final int WIRE_REACH = 2;

  private final LockGuard locks;
  private final LockService service;
  private final BlockKinds kinds;
  private final Placers placers;
  private final RandomGenerator random;
  private final Scheduler scheduler;
  private final Wallets wallets;
  private final Map<BlockPos, UUID> pendingAutoLocks = new HashMap<>();

  record PlacementTools(
      Placers placers, RandomGenerator random, Scheduler scheduler, Wallets wallets) {}

  LockListener(LockGuard locks, LockService service, BlockKinds kinds, PlacementTools tools) {
    this.locks = locks;
    this.service = service;
    this.kinds = kinds;
    this.wallets = tools.wallets();
    this.placers = tools.placers();
    this.random = tools.random();
    this.scheduler = tools.scheduler();
  }

  LockGuard locks() {
    return locks;
  }

  LockService service() {
    return service;
  }

  BlockKinds kinds() {
    return kinds;
  }

  @EventHandler(priority = EventPriority.LOW)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null
        || event.getAction() != Action.RIGHT_CLICK_BLOCK
        || !kinds.isLockable(block.getType())) {
      return;
    }
    var blocks = new ArrayList<>(LockGuard.covered(block));
    blocks.addAll(Chests.shelfChain(block));
    if (!locks.mayOpen(event.getPlayer(), blocks)) {
      var lock = locks.lockOf(block);
      if (lock != null
          && lock.options().type() == LockType.PASSWORD
          && !locks.knowsPassword(event.getPlayer().getUniqueId(), lock)) {
        locks.expectPassword(event.getPlayer().getUniqueId(), lock);
        event
            .getPlayer()
            .sendMessage(
                Notices.info("Type this lock's password in chat. It lasts until you log out."));
      }
      event.setUseInteractedBlock(Event.Result.DENY);
      event.setUseItemInHand(Event.Result.DENY);
      return;
    }
    var opened = locks.lockOf(block);
    if (opened != null) {
      service.touch(opened);
    }
    openAndClose(block);
  }

  boolean willLock(Player player) {
    return service.policy().autoLockOnPlace()
        && !service.modes().get(player.getUniqueId()).nolock();
  }

  /**
   * Iron doors, trapdoors and gates do not open on a click, so a player who may use the lock opens
   * them. They close after the configured delay, as does any door whose autoclose flag is on.
   */
  private void openAndClose(Block block) {
    if (!(block.getBlockData() instanceof Openable)) {
      return;
    }
    var lock = locks.lockOf(block);
    if (lock == null) {
      lock = Doors.otherHalf(block).map(locks::lockOf).orElse(null);
    }
    if (lock == null) {
      return;
    }
    var iron = block.getType().name().startsWith("IRON_");
    if (iron) {
      for (var part : LockGuard.container(block)) {
        if (part.getBlockData() instanceof Openable openable && !openable.isOpen()) {
          openable.setOpen(true);
          part.setBlockData(openable);
        }
      }
    }
    if (iron || lock.options().flags().autoclose()) {
      var _ =
          scheduler.runOnMainThreadLater(
              Duration.ofSeconds(service.policy().autocloseSeconds()), () -> close(block));
    }
  }

  private static void close(Block block) {
    for (var part : LockGuard.container(block)) {
      if (part.getBlockData() instanceof Openable openable && openable.isOpen()) {
        openable.setOpen(false);
        part.setBlockData(openable);
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW)
  void onChat(AsyncChatEvent event) {
    var playerId = event.getPlayer().getUniqueId();
    if (!locks.isAwaitingPassword(playerId)) {
      return;
    }
    event.setCancelled(true);
    var word = PlainTextComponentSerializer.plainText().serialize(event.message());
    var player = event.getPlayer();
    scheduler.runOnMainThread(() -> submitPassword(player, word));
  }

  /** Checks {@code word} against the password {@code player} was just asked for. */
  void submitPassword(Player player, String word) {
    var lockId = locks.takePasswordPrompt(player.getUniqueId());
    if (lockId == null) {
      return;
    }
    var lock = service.book().all().stream().filter(found -> found.id().equals(lockId)).findFirst();
    if (lock.isEmpty()) {
      player.sendMessage(Notices.error("That lock is gone."));
      return;
    }
    if (!lock.get().options().password().equals(word)) {
      player.sendMessage(Notices.error("That password is wrong."));
      return;
    }
    locks.grantPassword(player.getUniqueId(), lockId);
    player.sendMessage(Notices.success("Password accepted until you log out."));
  }

  @EventHandler(priority = EventPriority.LOW)
  void onQuit(PlayerQuitEvent event) {
    locks.forgetPasswords(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onClick(InventoryClickEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    var restriction = restriction(player, event.getView().getTopInventory());
    if (restriction == LockAccess.Movement.FULL) {
      return;
    }
    var takes = takesFrom(event);
    var puts = putsInto(event);
    var refused =
        switch (restriction) {
          case NONE, LOOK -> takes || puts;
          case PUT -> takes;
          case TAKE -> puts;
          case FULL -> false;
        };
    if (refused) {
      event.setCancelled(true);
      player.sendMessage(Notices.error(refusal(restriction)));
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDrag(InventoryDragEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    var top = event.getView().getTopInventory();
    var restriction = restriction(player, top);
    if (restriction == LockAccess.Movement.FULL) {
      return;
    }
    var touchesTop = event.getRawSlots().stream().anyMatch(slot -> slot < top.getSize());
    if (touchesTop && restriction != LockAccess.Movement.PUT) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (!locks.mayBreak(event.getPlayer(), List.of(event.getBlock()))) {
      event.setCancelled(true);
    }
  }

  /** The block is gone, so whatever lock covered it no longer does. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBroken(BlockBreakEvent event) {
    pendingAutoLocks.remove(LockGuard.position(event.getBlock()));
    if (locks.lockOf(event.getBlock()) != null) {
      service.release(LockGuard.position(event.getBlock()));
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    if (event instanceof BlockMultiPlaceEvent
        && !kinds.registersOnPlace(event.getBlock().getType())) {
      return;
    }
    var block = event.getBlock();
    if (locks.isSealed(block.getWorld())) {
      return;
    }
    var player = event.getPlayer();
    var type = block.getType();
    if (kinds.isRedstone(type) && !mayWireNear(player, block)) {
      event.setCancelled(true);
      return;
    }
    if (!kinds.registersOnPlace(type)) {
      return;
    }
    if (!willLock(player)) {
      return;
    }
    if (service.isSettling()) {
      player.sendMessage(
          Notices.error("Locks are saving; try placing the container again shortly."));
      event.setCancelled(true);
      return;
    }
    if (!mayPlaceBeside(player, block)) {
      event.setCancelled(true);
      return;
    }
    var partner = Chests.partner(block);
    if (partner.isPresent()
        && locks.lockOf(partner.get()) == null
        && !player.getUniqueId().equals(placers.placedBy(partner.get()))) {
      player.sendMessage(
          Notices.error("That chest belongs to someone else; place yours separately."));
      event.setCancelled(true);
      return;
    }
    if (service.book().countOf(player.getUniqueId()) >= service.policy().maxPerPlayer()
        && Chests.partner(block).map(locks::lockOf).orElse(null) == null
        && Doors.otherHalf(block).map(locks::lockOf).orElse(null) == null) {
      player.sendMessage(
          Notices.error("Your lock limit is full; unlock a container before placing another."));
      event.setCancelled(true);
    }
  }

  /**
   * A container placed where a lock was left behind clears it; a placed lockable remembers who
   * placed it; and a chest completing its owner's locked chest is locked with it.
   */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlaced(BlockPlaceEvent event) {
    if (event instanceof BlockMultiPlaceEvent
        && !kinds.registersOnPlace(event.getBlock().getType())) {
      return;
    }
    var block = event.getBlock();
    if (locks.isSealed(block.getWorld())) {
      return;
    }
    var position = LockGuard.position(block);
    var already = service.book().lockAt(position).orElse(null);
    if (already != null) {
      var partner = Doors.otherHalf(block).map(LockGuard::position).orElse(null);
      if (partner != null && already.blocks().contains(partner)) {
        return;
      }
      service.release(position);
    }
    if (!kinds.isLockable(block.getType())) {
      return;
    }
    if (!placers.record(block, event.getPlayer().getUniqueId())) {
      block.breakNaturally();
      event
          .getPlayer()
          .sendMessage(
              Notices.error(
                  "The container could not remember its owner and was returned; try again."));
      return;
    }
    if (extendJoinedChest(event.getPlayer(), block, position)) {
      return;
    }
    if (extendDoorHalf(event.getPlayer(), block, position)) {
      return;
    }
    if (!kinds.registersOnPlace(block.getType()) || !willLock(event.getPlayer())) {
      return;
    }
    autoLockPlaced(event.getPlayer(), block, position);
  }

  private boolean extendJoinedChest(Player player, Block block, BlockPos position) {
    var partner = Chests.partner(block);
    if (partner.isEmpty()) {
      return false;
    }
    var lock = locks.lockOf(partner.get());
    if (lock == null || !locks.mayBreak(player, lock, partner.get())) {
      return false;
    }
    var extended = service.extendOnPlacement(lock, position);
    if (extended.isEmpty()) {
      revokeUnstoredPlacement(player, block, position);
      return true;
    }
    var _ =
        extended
            .get()
            .saved()
            .whenComplete(
                (saved, failure) -> {
                  if (failure != null) {
                    revokeUnstoredPlacement(player, block, position);
                  }
                });
    return true;
  }

  /** The other half of this door is already locked, so this half joins that lock. */
  private boolean extendDoorHalf(Player player, Block block, BlockPos position) {
    var partner = Doors.otherHalf(block).orElse(null);
    if (partner == null) {
      return false;
    }
    var lock = locks.lockOf(partner);
    if (lock == null
        || lock.blocks().contains(position)
        || !locks.mayBreak(player, lock, partner)) {
      return lock != null;
    }
    var extended = service.extendOnPlacement(lock, position);
    if (extended.isEmpty()) {
      revokeUnstoredPlacement(player, block, position);
      return true;
    }
    var _ =
        extended
            .get()
            .saved()
            .whenComplete(
                (saved, failure) -> {
                  if (failure != null) {
                    revokeUnstoredPlacement(player, block, position);
                  }
                });
    return true;
  }

  void autoLockPlaced(Player player, Block block, BlockPos position) {
    var blocks = LockGuard.container(block).stream().map(LockGuard::position).toList();
    var standing =
        new LockAttempt.Standing(player.getUniqueId(), true, locks.ground(player, block), false);
    var token = TownRules.newId(random);
    pendingAutoLocks.put(position, token);
    var result = service.lock(player.getUniqueId(), blocks, standing);
    switch (result) {
      case Result.Ok<Change<Lock>, List<LockProblem>>(var change) -> {
        var _ =
            change
                .saved()
                .whenComplete(
                    (saved, failure) -> {
                      if (!pendingAutoLocks.remove(position, token)) {
                        return;
                      }
                      if (failure != null) {
                        revokeUnstoredPlacement(player, block, position);
                        return;
                      }
                      LockFee.charge(
                          new LockFee.Bill(wallets, scheduler, service, player), change.value());
                    });
      }
      case Result.Err<Change<Lock>, List<LockProblem>>(var _) -> {
        pendingAutoLocks.remove(position, token);
        revokeUnstoredPlacement(player, block, position);
      }
    }
  }

  private void revokeUnstoredPlacement(Player player, Block block, BlockPos position) {
    if (kinds.isLockable(block.getType()) && player.getUniqueId().equals(placers.placedBy(block))) {
      block.breakNaturally();
      service.release(position);
    }
    player.sendMessage(
        Notices.error("The container could not be locked and was returned; try again."));
  }

  /** No container or hopper beside someone else's locked container, where it could reach in. */
  private boolean mayPlaceBeside(Player player, Block block) {
    for (var face : Redstone.FACES) {
      if (!locks.mayBreak(player, List.of(block.getRelative(face)))) {
        return false;
      }
    }
    return true;
  }

  /** No redstone within reach of someone else's locked dispenser, dropper or crafter. */
  private boolean mayWireNear(Player player, Block block) {
    for (var dx = -WIRE_REACH; dx <= WIRE_REACH; dx++) {
      for (var dy = -WIRE_REACH; dy <= WIRE_REACH; dy++) {
        for (var dz = -WIRE_REACH; dz <= WIRE_REACH; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= WIRE_REACH
              && !mayWire(player, block.getRelative(dx, dy, dz))) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private boolean mayWire(Player player, Block near) {
    if (!kinds.isRedstoneDriven(near.getType())) {
      return true;
    }
    return locks.mayWire(player, List.of(near));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onItemMove(InventoryMoveItemEvent event) {
    if (!locks.mayTransfer(event.getSource(), event.getDestination())) {
      event.setCancelled(true);
    }
  }

  /** Pre-existing wiring and piston-moved power sources cannot bypass a machine's lock option. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDispense(BlockDispenseEvent event) {
    if (!locks.mayAutomate(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onCrafterCraft(CrafterCraftEvent event) {
    if (!locks.mayAutomate(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  /** Copper golems carry items for nobody's lock, so they never take from or fill a locked one. */
  @EventHandler(priority = EventPriority.LOW)
  void onGolemTarget(ItemTransportingEntityValidateTargetEvent event) {
    for (var block : LockGuard.container(event.getBlock())) {
      var lock = locks.lockOf(block);
      if (lock != null && !lock.options().flags().golem()) {
        event.setAllowed(false);
        return;
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(this::resistsExplosion);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(this::resistsExplosion);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    // The list holds the blocks the piston would destroy (a shulker box) as well as move.
    if (touchesLock(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    if (touchesLock(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  private boolean touchesLock(List<Block> blocks) {
    return blocks.stream().anyMatch(block -> locks.lockOf(block) != null);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (locks.lockOf(event.getBlock()) != null) {
      event.setCancelled(true);
    }
  }

  /** Withers, endermen, ravagers and every other mob leave locked blocks alone. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityChange(EntityChangeBlockEvent event) {
    if (locks.lockOf(event.getBlock()) != null) {
      event.setCancelled(true);
    }
  }

  private boolean resistsExplosion(Block block) {
    var lock = locks.lockOf(block);
    return lock != null && !lock.options().flags().explosions();
  }

  private LockAccess.Movement restriction(Player player, Inventory top) {
    var result = LockAccess.Movement.FULL;
    for (var location : Chests.locations(top)) {
      result = stricter(result, locks.movement(player, Guard.world(location).getBlockAt(location)));
    }
    return result;
  }

  private static LockAccess.Movement stricter(
      LockAccess.Movement current, LockAccess.Movement next) {
    if (current == LockAccess.Movement.NONE || next == LockAccess.Movement.NONE) {
      return LockAccess.Movement.NONE;
    }
    if (current == LockAccess.Movement.LOOK || next == LockAccess.Movement.LOOK) {
      return LockAccess.Movement.LOOK;
    }
    if (current == next || next == LockAccess.Movement.FULL) {
      return current;
    }
    if (current == LockAccess.Movement.FULL) {
      return next;
    }
    return LockAccess.Movement.LOOK;
  }

  private static boolean takesFrom(InventoryClickEvent event) {
    if (event.getClick() == ClickType.DOUBLE_CLICK) {
      return true;
    }
    var top = event.getView().getTopInventory();
    var clicked = event.getClickedInventory();
    if (clicked == null || !clicked.equals(top)) {
      return false;
    }
    return switch (event.getClick()) {
      case SHIFT_LEFT, SHIFT_RIGHT, DROP, CONTROL_DROP -> occupied(event.getCurrentItem());
      case NUMBER_KEY, SWAP_OFFHAND -> true;
      default -> occupied(event.getCurrentItem());
    };
  }

  private static boolean putsInto(InventoryClickEvent event) {
    var top = event.getView().getTopInventory();
    var clicked = event.getClickedInventory();
    if (clicked == null) {
      return false;
    }
    if (clicked.equals(top)) {
      return switch (event.getClick()) {
        case NUMBER_KEY, SWAP_OFFHAND -> true;
        case SHIFT_LEFT, SHIFT_RIGHT, DROP, CONTROL_DROP, DOUBLE_CLICK -> false;
        default -> occupied(event.getCursor());
      };
    }
    return event.isShiftClick() && occupied(event.getCurrentItem());
  }

  private static boolean occupied(@Nullable ItemStack stack) {
    return stack != null && !stack.getType().isAir();
  }

  private static String refusal(LockAccess.Movement movement) {
    return switch (movement) {
      case PUT -> "This lock only accepts items.";
      case TAKE -> "This lock only gives items.";
      case LOOK, NONE -> "This lock is display only.";
      case FULL -> "This lock is open.";
    };
  }
}
