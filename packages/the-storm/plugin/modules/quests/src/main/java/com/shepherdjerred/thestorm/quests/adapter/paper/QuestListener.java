package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.CraftCount;
import com.shepherdjerred.thestorm.quests.domain.engine.KillCredit;
import com.shepherdjerred.thestorm.quests.domain.engine.PartyActivity;
import com.shepherdjerred.thestorm.quests.domain.engine.PickupCredit;
import com.shepherdjerred.thestorm.quests.domain.engine.PlacedBlocks;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEvent;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.ItemMergeEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Turns what players do into quest events. Everything listens at MONITOR and ignores cancelled
 * events, so only what really happened counts. Kills and pickups are shared with players within the
 * party radius when they have recently played.
 */
final class QuestListener implements Listener {

  /** How many player-placed blocks are remembered so breaking them does not count. */
  static final int PLACED_MEMORY = 4096;

  record Wiring(
      QuestService service,
      QuestContent content,
      SidebarDisplay sidebars,
      QuestsConfig config,
      InstantSource time) {}

  private final QuestService service;
  private final QuestContent content;
  private final SidebarDisplay sidebars;
  private final QuestsConfig config;
  private final InstantSource time;
  private final PlacedBlocks placed = new PlacedBlocks(PLACED_MEMORY);
  private final PartyActivity activity = new PartyActivity();

  QuestListener(Wiring wiring) {
    this.service = wiring.service();
    this.content = wiring.content();
    this.sidebars = wiring.sidebars();
    this.config = wiring.config();
    this.time = wiring.time();
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    if (!inMainWorld(event.getPlayer())) {
      return;
    }
    activity.acted(event.getPlayer().getUniqueId(), time.instant());
    var _ = service.join(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    service.quit(event.getPlayer().getUniqueId());
    sidebars.forget(event.getPlayer().getUniqueId());
    activity.forget(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onWorldChanged(PlayerChangedWorldEvent event) {
    if (inMainWorld(event.getPlayer())) {
      activity.acted(event.getPlayer().getUniqueId(), time.instant());
      if (service.state(event.getPlayer().getUniqueId()).isEmpty()) {
        var _ = service.join(event.getPlayer().getUniqueId());
      }
    } else {
      sidebars.show(event.getPlayer(), Optional.empty());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDeath(EntityDeathEvent event) {
    var killer = event.getEntity().getKiller();
    var spawnReason = event.getEntity().getEntitySpawnReason();
    if (killer == null
        || spawnReason == null
        || event.getEntity() instanceof Player
        || !inMainWorld(killer)
        || !KillCredit.eligible(spawnReason.name(), event.getEntity().getScoreboardTags())) {
      return;
    }
    activity.acted(killer.getUniqueId(), time.instant());
    service.event(
        killer.getUniqueId(),
        new QuestEvent.Killed(event.getEntity().getType().name()),
        nearby(killer));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPickup(EntityPickupItemEvent event) {
    if (!(event.getEntity() instanceof Player player) || !inMainWorld(player)) {
      return;
    }
    activity.acted(player.getUniqueId(), time.instant());
    var item = event.getItem();
    var stack = item.getItemStack();
    var amount =
        PickupCredit.amount(
            stack.getAmount(),
            event.getRemaining(),
            item.getScoreboardTags().contains(PickupCredit.PLAYER_DROPPED));
    if (amount == 0) {
      return;
    }
    service.event(
        player.getUniqueId(),
        new QuestEvent.Collected(ItemStacks.facts(stack), amount),
        nearby(player));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDrop(PlayerDropItemEvent event) {
    event.getItemDrop().addScoreboardTag(PickupCredit.PLAYER_DROPPED);
    if (inMainWorld(event.getPlayer())) {
      activity.acted(event.getPlayer().getUniqueId(), time.instant());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onItemMerge(ItemMergeEvent event) {
    if (event.getEntity().getScoreboardTags().contains(PickupCredit.PLAYER_DROPPED)) {
      event.getTarget().addScoreboardTag(PickupCredit.PLAYER_DROPPED);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onCraft(CraftItemEvent event) {
    if (!(event.getWhoClicked() instanceof Player player) || !inMainWorld(player)) {
      return;
    }
    activity.acted(player.getUniqueId(), time.instant());
    var result = event.getRecipe().getResult();
    var ingredients = new ArrayList<Integer>();
    for (var stack : Locations.slots(event.getInventory().getMatrix())) {
      if (stack != null && !stack.getType().isAir()) {
        ingredients.add(stack.getAmount());
      }
    }
    var made =
        CraftCount.of(event.isShiftClick(), result.getAmount(), ingredients, room(player, result));
    if (made > 0) {
      service.event(
          player.getUniqueId(), new QuestEvent.Crafted(ItemStacks.facts(result), made), List.of());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFish(PlayerFishEvent event) {
    if (inMainWorld(event.getPlayer())
        && event.getState() == PlayerFishEvent.State.CAUGHT_FISH
        && event.getCaught() instanceof Item caught) {
      activity.acted(event.getPlayer().getUniqueId(), time.instant());
      service.event(
          event.getPlayer().getUniqueId(),
          new QuestEvent.Fished(ItemStacks.facts(caught.getItemStack())),
          List.of());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (!inMainWorld(event.getPlayer())) {
      return;
    }
    activity.acted(event.getPlayer().getUniqueId(), time.instant());
    if (placed.broken(position(event.getBlock()))) {
      service.event(
          event.getPlayer().getUniqueId(),
          new QuestEvent.Mined(event.getBlock().getType().name()),
          List.of());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    if (!inMainWorld(event.getPlayer())) {
      return;
    }
    activity.acted(event.getPlayer().getUniqueId(), time.instant());
    placed.placed(position(event.getBlockPlaced()));
    service.event(
        event.getPlayer().getUniqueId(),
        new QuestEvent.Placed(event.getBlockPlaced().getType().name()),
        List.of());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (!event.hasChangedBlock() || !inMainWorld(event.getPlayer())) {
      return;
    }
    activity.acted(event.getPlayer().getUniqueId(), time.instant());
    var to = event.getTo();
    var world = to.getWorld().getKey().asString();
    var inside =
        content.regions().values().stream()
            .filter(region -> region.contains(world, to.getX(), to.getY(), to.getZ()))
            .map(region -> region.id())
            .collect(Collectors.toUnmodifiableSet());
    if (!inside.isEmpty()) {
      service.event(event.getPlayer().getUniqueId(), new QuestEvent.Reached(inside), List.of());
    }
  }

  /** Online players within the party radius of {@code player}, in the same world. */
  private List<UUID> nearby(Player player) {
    if (config.party().radius() <= 0) {
      return List.of();
    }
    var now = time.instant();
    return Locations.of(player).getNearbyPlayers(config.party().radius()).stream()
        .filter(other -> !other.equals(player))
        .filter(other -> activity.active(other.getUniqueId(), now, config.party().active()))
        .map(Player::getUniqueId)
        .toList();
  }

  private boolean inMainWorld(Player player) {
    return player.getWorld().getName().equals(config.mainWorld());
  }

  private static int room(Player player, ItemStack result) {
    var room = 0;
    for (var stack : Locations.slots(player.getInventory().getStorageContents())) {
      if (stack == null || stack.getType().isAir()) {
        room += result.getMaxStackSize();
      } else if (stack.isSimilar(result)) {
        room += Math.max(0, stack.getMaxStackSize() - stack.getAmount());
      }
    }
    return room;
  }

  private static PlacedBlocks.Position position(Block block) {
    Location at = block.getLocation();
    return new PlacedBlocks.Position(
        block.getWorld().getKey().asString(), at.getBlockX(), at.getBlockY(), at.getBlockZ());
  }
}
