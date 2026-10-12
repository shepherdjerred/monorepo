package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Decoy;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Demolitions;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Engineer;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.ProjectileHitEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/**
 * What players do with their kits in a live match, turned into the ability inputs the rules answer:
 * a Medic's or Warper's wand, a Teleporter's creator and remote, a Demolitions' landmines. The
 * server's own handling of these clicks and placements is always cancelled; the rules decide and
 * the {@link KitPowers} carry it out. Frozen hands are enforced here too. Main thread only.
 */
final class KitListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final TeleporterClicks clicks;

  /** A kit item's right-click; the vanilla use is always denied. */
  @FunctionalInterface
  private interface Use {
    void use(Player player, PlayerInteractEvent event);
  }

  /** Each kit's right-click items: kit to item to what it does. */
  private final Map<String, Map<Material, Use>> uses;

  KitListener(MatchRunner runner, PaperContext context, Keys keys, TeleporterMenus teleporters) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.clicks = new TeleporterClicks(runner, keys);
    this.uses =
        Map.of(
            Medic.ID,
            Map.of(Material.BLAZE_ROD, (player, event) -> heal(player, Places.at(player))),
            Explosive.ID,
            Map.of(
                Material.EGG,
                (player, event) -> runner.kits().act(player, new AbilityInput.LaunchRpg()),
                Material.FIREWORK_STAR,
                (player, event) -> runner.kits().act(player, new AbilityInput.ThrowGrenade())),
            Teleporter.ID,
            Map.of(
                Material.QUARTZ,
                this::creator,
                Material.MAP,
                (player, event) -> teleporters.open(player)),
            Sacrificial.ID,
            Map.of(
                Material.SHEARS,
                (player, event) -> runner.kits().act(player, new AbilityInput.Sever())),
            Engineer.ID,
            Map.of(Material.BRICKS, this::barricade),
            Decoy.ID,
            Map.of(
                Material.ARMOR_STAND,
                (player, event) ->
                    runner
                        .kits()
                        .act(
                            player,
                            new AbilityInput.Decoy(
                                Places.vec(Places.at(player).getDirection().setY(0))))));
  }

  /** An Engineer raises a barricade on the block it clicked. */
  private void barricade(Player player, PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block != null) {
      runner
          .kits()
          .act(
              player,
              new AbilityInput.Barricade(
                  KitWorldListener.wall(player, block, event.getBlockFace())));
    }
  }

  private Optional<String> kit(Player player) {
    if (!player.getWorld().equals(context.mapWorld()) || !runner.fighting(player.getUniqueId())) {
      return Optional.empty();
    }
    return runner.memberOf(player.getUniqueId()).flatMap(member -> member.kit());
  }

  private static boolean leftClick(Action action) {
    return action == Action.LEFT_CLICK_AIR || action == Action.LEFT_CLICK_BLOCK;
  }

  private static boolean rightClick(Action action) {
    return action == Action.RIGHT_CLICK_AIR || action == Action.RIGHT_CLICK_BLOCK;
  }

  private boolean holding(ItemStack item, Material material) {
    return item.getType() == material && keys.isKitItem(item);
  }

  // ---- right-clicks ---------------------------------------------------------------------------

  @EventHandler(priority = EventPriority.HIGHEST)
  void onInteract(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var kit = kit(player);
    if (kit.isEmpty() || event.getHand() == EquipmentSlot.OFF_HAND) {
      return;
    }
    var item = event.getItem();
    var block = event.getClickedBlock();
    if (event.getAction() == Action.PHYSICAL && block != null) {
      steppedOn(player, block, event);
      return;
    }
    if (Medic.ID.equals(kit.orElseThrow())
        && leftClick(event.getAction())
        && item != null
        && holding(item, Material.BLAZE_ROD)) {
      // Red Warfare's Medic waved on any click with the wand, left as well as right.
      heal(player, Places.at(player));
    }
    if (event.getAction() == Action.LEFT_CLICK_BLOCK && block != null) {
      struck(player, block, event);
      return;
    }
    if (event.getAction() == Action.RIGHT_CLICK_BLOCK
        && block != null
        && !teleClick(event, kit.orElseThrow(), block)) {
      return;
    }
    if (item == null || !rightClick(event.getAction())) {
      return;
    }
    var use = uses.getOrDefault(kit.orElseThrow(), Map.of()).get(item.getType());
    if (use != null && keys.isKitItem(item)) {
      deny(event);
      use.use(player, event);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onInteractEntity(PlayerInteractEntityEvent event) {
    var player = event.getPlayer();
    var kit = kit(player);
    if (kit.isEmpty() || event.getHand() == EquipmentSlot.OFF_HAND) {
      return;
    }
    var item = player.getInventory().getItemInMainHand();
    var clicked = event.getRightClicked();
    switch (kit.orElseThrow()) {
      case Medic.ID -> {
        if (holding(item, Material.BLAZE_ROD)) {
          heal(player, Places.at(clicked));
        }
      }
      case Warper.ID -> {
        if (holding(item, Material.BLAZE_ROD)) {
          warp(player, clicked);
        }
      }
      default -> {}
    }
  }

  private static void deny(PlayerInteractEvent event) {
    event.setUseItemInHand(Event.Result.DENY);
    event.setUseInteractedBlock(Event.Result.DENY);
  }

  /** A Medic's wand wave around {@code center}: every ally within reach is a patient. */
  void heal(Player medic, Location center) {
    var self = runner.memberOf(medic.getUniqueId()).orElseThrow();
    var patients = new ArrayList<AbilityInput.Patient>();
    var nearbyMedics = 0;
    for (var member : runner.match().members()) {
      if (!member.team().equals(self.team())) {
        continue;
      }
      var entity = runner.entity(member.id());
      if (entity.isEmpty() || !entity.orElseThrow().getWorld().equals(medic.getWorld())) {
        continue;
      }
      var player = entity.orElseThrow();
      // Red Warfare counted every teammate on the Medic kit within 8 blocks, the dead among them.
      if (member.kit().filter(Medic.ID::equals).isPresent()
          && Places.at(player).distance(Places.at(medic)) <= Medic.CROWD) {
        nearbyMedics++;
      }
      if (member.alive() && Places.at(player).distance(center) <= Medic.REACH) {
        patients.add(
            new AbilityInput.Patient(
                member.id(),
                Places.at(player).distance(Places.at(medic)),
                player.getHealth(),
                PlayerAttributes.maxHealth(player),
                player.hasPotionEffect(org.bukkit.potion.PotionEffectType.POISON),
                regenerating(player)));
      }
    }
    runner
        .kits()
        .act(
            medic,
            new AbilityInput.Heal(
                patients, nearbyMedics, medic.getHealth(), PlayerAttributes.maxHealth(medic)));
  }

  /**
   * Whether a spent wave leaves {@code player}'s Regeneration alone: Red Warfare only topped it up
   * when there was none, or Regeneration I with under a second left.
   */
  private static boolean regenerating(Player player) {
    var regeneration = player.getPotionEffect(org.bukkit.potion.PotionEffectType.REGENERATION);
    return regeneration != null
        && !(regeneration.getAmplifier() == 0 && regeneration.getDuration() < 20);
  }

  /** A Warper's wand on {@code clicked}: it and everyone within 3 blocks of it. */
  void warp(Player warper, Entity clicked) {
    var targets = new LinkedHashSet<CombatantId>();
    runner.memberOf(clicked.getUniqueId()).ifPresent(member -> targets.add(member.id()));
    for (var near : clicked.getNearbyEntities(3, 3, 3)) {
      runner.memberOf(near.getUniqueId()).ifPresent(member -> targets.add(member.id()));
    }
    runner.kits().act(warper, new AbilityInput.Warp(List.copyOf(targets)));
  }

  /** A Teleporter's creator on a block: break one of its teleporters there, or place one. */
  private void creator(Player player, PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block != null) {
      creator(player, block, event.getBlockFace());
    }
  }

  /** The Teleport Creator on {@code block}: a new teleporter, or breaking or naming one. */
  void creator(Player player, Block block, BlockFace face) {
    clicks.create(player, block, face);
  }

  /** Mining a teleporter breaks it, whatever else refuses the dig. */
  @EventHandler(priority = EventPriority.LOWEST)
  void onBreak(BlockBreakEvent event) {
    if (kit(event.getPlayer()).isPresent()) {
      clicks.mined(event.getPlayer(), event.getBlock());
    }
  }

  /** Whether {@code block} could hold a teleporter: solid, with two open blocks above it. */
  static boolean roomAbove(Block block) {
    return TeleporterClicks.valid(block);
  }

  /** Red Warfare's right-click rules for teleporter blocks; whether the item's use goes on. */
  private boolean teleClick(PlayerInteractEvent event, String kit, Block block) {
    var item = event.getItem();
    if (clicks.rightClick(event.getPlayer(), kit, item, block)) {
      return true;
    }
    if (item != null && keys.isKitItem(item) && item.getType() == Material.QUARTZ) {
      deny(event);
    }
    return false;
  }

  /** {@code player} stepped on a pressure plate: a landmine, if a kit placed it. */
  private void steppedOn(Player player, Block block, PlayerInteractEvent event) {
    var placed = runner.match().abilities().placedAt(Places.pos(block));
    if (placed.filter(Placed.Mine.class::isInstance).isEmpty()) {
      return;
    }
    event.setCancelled(true);
    runner.kits().act(player, new AbilityInput.StepOnMine(Places.pos(block)));
  }

  /**
   * {@code player} hit a block: on a landmine the dig is refused, as Red Warfare's left-click
   * handler refused it, and they are told whose it is. A teleporter is mined like any block.
   */
  private void struck(Player player, Block block, PlayerInteractEvent event) {
    var pos = Places.pos(block);
    if (runner.match().abilities().placedAt(pos).orElse(null) instanceof Placed.Mine) {
      event.setCancelled(true);
      runner.kits().act(player, new AbilityInput.BreakMine(pos));
    }
  }

  // ---- projectiles ---------------------------------------------------------------------------

  /** A Wraith's arrow leaves for two seconds and trails the team's colour. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGHEST)
  void onShoot(EntityShootBowEvent event) {
    if (!(event.getEntity() instanceof Player player)
        || kit(player).filter(Wraith.ID::equals).isEmpty()) {
      return;
    }
    var slot = player.getInventory().first(Material.ARROW);
    if (slot < 0) {
      return;
    }
    runner.kits().act(player, new AbilityInput.ShootBow(slot));
    if (event.getProjectile() instanceof AbstractArrow arrow) {
      runner
          .memberOf(player.getUniqueId())
          .flatMap(m -> m.team())
          .ifPresent(
              team -> runner.powers().projectiles().trail(arrow, Classic.dust(team).getColor()));
    }
  }

  /** An RPG explodes where it hits a block. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onProjectileHit(ProjectileHitEvent event) {
    if (runner.powers().projectiles().hit(event.getEntity())) {
      event.setCancelled(true);
    }
  }

  /** An RPG that hits someone explodes rather than striking them. */
  @EventHandler(priority = EventPriority.LOWEST)
  void onRpgStrike(EntityDamageByEntityEvent event) {
    if (runner.kits().isKitEntity(event.getDamager())) {
      event.setCancelled(true);
      runner.powers().projectiles().hit(event.getDamager());
    }
  }

  // ---- placing -------------------------------------------------------------------------------

  /** A Demolitions sets a landmine: the server's placement is replaced by the rules'. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onPlace(BlockPlaceEvent event) {
    var player = event.getPlayer();
    var kit = kit(player);
    if (kit.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    if (!kit.orElseThrow().equals(Demolitions.ID)
        || event.getItemInHand().getType() != Material.STONE_PRESSURE_PLATE) {
      return;
    }
    if (!event.getBlockReplacedState().getType().isAir()) {
      Classic.say(player, KitText.RED + "Must place in a valid location!");
      return;
    }
    // The server has already set the plate; put back what stood there so the rules' own
    // placement remembers it, and the reset restores it.
    var _ = event.getBlockReplacedState().update(true, false);
    if (event
        .getBlockPlaced()
        .getRelative(BlockFace.DOWN)
        .getType()
        .name()
        .startsWith("INFESTED_")) {
      return;
    }
    runner.kits().act(player, new AbilityInput.PlaceMine(Places.pos(event.getBlockPlaced())));
  }

  // ---- frozen hands ---------------------------------------------------------------------------

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onHeld(PlayerItemHeldEvent event) {
    if (frozen(event.getPlayer())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onSwap(PlayerSwapHandItemsEvent event) {
    if (frozen(event.getPlayer())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onClick(InventoryClickEvent event) {
    if (event.getWhoClicked() instanceof Player player && frozen(player)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onDrag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player && frozen(player)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onOffhand(PlayerInteractEvent event) {
    var player = event.getPlayer();
    if (event.getHand() != EquipmentSlot.OFF_HAND || !frozen(player)) {
      return;
    }
    event.setCancelled(true);
    if (event.getItem() != null && !event.getItem().isEmpty()) {
      player.sendMessage(
          net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer.legacySection()
              .deserialize(
                  com.shepherdjerred.thestorm.rwf.domain.ability.kits.Frost.OFFHAND_MESSAGE));
    }
  }

  private boolean frozen(Player player) {
    return runner.fighting(player.getUniqueId()) && runner.powers().frozen(player.getUniqueId());
  }
}
