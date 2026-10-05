package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.Optional;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Wolf;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Survival interactions and downing run through the shared arena protections. */
final class SurvivalListener implements Listener {
  private final Arenas arenas;

  SurvivalListener(Arenas arenas) {
    this.arenas = arenas;
  }

  Optional<SurvivalRunner> of(Player player) {
    return arenas
        .of(player.getUniqueId())
        .filter(SurvivalRunner.class::isInstance)
        .map(SurvivalRunner.class::cast);
  }

  private Optional<SurvivalRunner> enemy(org.bukkit.entity.Entity entity) {
    return arenas.all().stream()
        .filter(SurvivalRunner.class::isInstance)
        .map(SurvivalRunner.class::cast)
        .filter(r -> r.world().isWaveMob(entity))
        .findFirst();
  }

  private static @org.jspecify.annotations.Nullable Player attacker(
      org.bukkit.entity.Entity entity) {
    return switch (entity) {
      case Player direct -> direct;
      case Projectile projectile when projectile.getShooter() instanceof Player shooter -> shooter;
      case Wolf wolf when wolf.getOwner() instanceof Player owner -> owner;
      default -> null;
    };
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void weaponDamage(EntityDamageByEntityEvent event) {
    outgoing(event);
    incoming(event);
  }

  private void outgoing(EntityDamageByEntityEvent event) {
    var player = attacker(event.getDamager());
    if (player == null || !(event.getEntity() instanceof LivingEntity target)) return;
    of(player)
        .filter(r -> r.world().isWaveMob(target))
        .ifPresent(
            r -> {
              if (r.combat().scriptedDamage()) return;
              var factor =
                  event.getDamager() instanceof Projectile projectile
                      ? r.combat().projectileMultiplier(projectile)
                      : event.getDamager() instanceof Wolf wolf && r.world().isFriendlyWolf(wolf)
                          ? r.talents().companionDamage(player.getUniqueId())
                          : heldDamage(r, player);
              event.setDamage(event.getDamage() * factor);
            });
  }

  private static double heldDamage(SurvivalRunner runner, Player player) {
    return runner.items().multiplier(player.getInventory().getItemInMainHand());
  }

  private void incoming(EntityDamageByEntityEvent event) {
    var source = damageSource(event.getDamager());
    enemy(source)
        .ifPresent(
            r -> {
              if (r.combat().bossEntity(source) && !r.combat().boss().orElseThrow().striking()) {
                event.setCancelled(true);
              } else if (event.getDamager() instanceof Projectile
                  && event.getEntity() instanceof Player) {
                event.setDamage(r.combat().incoming(source, event.getDamage()));
              }
            });
    if (event.getEntity() instanceof Player player && event.getDamager() instanceof LivingEntity) {
      of(player)
          .filter(r -> r.world().isWaveMob(source) && !r.combat().bossEntity(source))
          .filter(
              r ->
                  r.game().player(player.getUniqueId()).orElseThrow().role()
                      == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass.FIGHTER)
          .ifPresent(_ -> event.setDamage(event.getDamage() * .9));
    }
  }

  private static org.bukkit.entity.Entity damageSource(org.bukkit.entity.Entity damager) {
    if (damager instanceof Projectile projectile
        && projectile.getShooter() instanceof LivingEntity shooter) return shooter;
    if (damager instanceof org.bukkit.entity.EvokerFangs fangs && fangs.getOwner() != null)
      return java.util.Objects.requireNonNull(fangs.getOwner());
    return damager;
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void launched(org.bukkit.event.entity.ProjectileLaunchEvent event) {
    if (event.getEntity() instanceof org.bukkit.entity.Trident trident
        && trident.getShooter() instanceof Player player) {
      of(player).ifPresent(runner -> launchedTrident(event, trident, player, runner));
    }
    if (event.getEntity().getShooter() instanceof LivingEntity shooter
        && !(shooter instanceof Player)) {
      enemy(shooter)
          .ifPresent(
              r -> {
                if (!r.combat().shot(shooter)) event.setCancelled(true);
              });
    }
  }

  private static void launchedTrident(
      org.bukkit.event.entity.ProjectileLaunchEvent event,
      org.bukkit.entity.Trident trident,
      Player player,
      SurvivalRunner runner) {
    runner.interrupted(player.getUniqueId());
    if (!runner.isFighter(player.getUniqueId())) {
      event.setCancelled(true);
      return;
    }
    var factor = runner.items().multiplier(trident.getItemStack());
    if (runner.game().player(player.getUniqueId()).orElseThrow().role()
        == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass.RANGER) factor *= 1.1;
    factor *= runner.talents().shot(player, trident);
    runner.combat().projectile(trident, factor);
    runner.tridents().launched(player, trident);
    runner.legendary().launched(trident, trident.getItemStack());
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void status(org.bukkit.event.entity.EntityPotionEffectEvent event) {
    if (event.getEntity() instanceof Player player
        && event.getNewEffect() != null
        && (event.getNewEffect().getType().equals(org.bukkit.potion.PotionEffectType.POISON)
            || event
                .getNewEffect()
                .getType()
                .equals(org.bukkit.potion.PotionEffectType.SLOWNESS))) {
      of(player).filter(r -> r.combat().round() <= 7).ifPresent(_ -> event.setCancelled(true));
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void damage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player) {
      of(player)
          .ifPresent(
              runner -> {
                if (runner.downed(player.getUniqueId())
                    || !runner.isFighter(player.getUniqueId())) {
                  event.setCancelled(true);
                  return;
                }
                var armor =
                    java.util.Arrays.stream(player.getInventory().getArmorContents())
                        .filter(java.util.Objects::nonNull)
                        .filter(runner.items()::equipment)
                        .mapToInt(runner.items()::tier)
                        .sum();
                event.setDamage(event.getDamage() * (1 - Math.min(.2, armor * .02)));
                var lethal = event.getFinalDamage() >= player.getHealth();
                if (lethal) {
                  event.setCancelled(true);
                }
                runner.hurt(player, event.getFinalDamage());
              });
    } else if (event.getEntity() instanceof LivingEntity enemy) {
      arenas.all().stream()
          .filter(SurvivalRunner.class::isInstance)
          .map(SurvivalRunner.class::cast)
          .filter(r -> r.world().owns(enemy))
          .forEach(
              r ->
                  r.combat()
                      .boss()
                      .filter(b -> b.entity().equals(enemy))
                      .ifPresent(b -> protectBoss(b, event, r.context().time().instant())));
    }
  }

  private static void protectBoss(
      SurvivalBoss boss, EntityDamageEvent event, java.time.Instant now) {
    var limit = boss.damageLimit();
    if (boss.protectedNow(now) || limit <= 0) {
      event.setCancelled(true);
      return;
    }
    event.setDamage(Math.min(event.getDamage() * boss.damageMultiplier(now), limit));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void hit(EntityDamageByEntityEvent event) {
    var player = attacker(event.getDamager());
    if (player == null || !(event.getEntity() instanceof LivingEntity enemy)) return;
    of(player).ifPresent(runner -> hit(runner, event, player, enemy));
  }

  private static void hit(
      SurvivalRunner runner, EntityDamageByEntityEvent event, Player player, LivingEntity enemy) {
    runner.interrupted(player.getUniqueId());
    runner.combat().hit(enemy, player);
    if (event.getFinalDamage() <= 0) return;
    runner.boons().hit(player, enemy, event.getDamager() instanceof Projectile);
    runner.drops().hit(player, enemy);
    if (event.getDamager() instanceof Projectile projectile) {
      runner.relics().hit(player, enemy, projectile);
      runner.legendary().hit(player, enemy, projectile);
    } else if (event.getDamager() instanceof Player) runner.legendary().melee(player, enemy);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void death(EntityDeathEvent event) {
    arenas.all().stream()
        .filter(SurvivalRunner.class::isInstance)
        .map(SurvivalRunner.class::cast)
        .filter(r -> r.world().isWaveMob(event.getEntity()))
        .forEach(
            runner -> {
              runner.drops().died(event.getEntity());
              runner
                  .combat()
                  .died(
                      event.getEntity(),
                      runner.game().participants().stream()
                          .map(p -> p.id())
                          .collect(java.util.stream.Collectors.toUnmodifiableSet()));
            });
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void move(PlayerMoveEvent event) {
    of(event.getPlayer())
        .filter(r -> r.downed(event.getPlayer().getUniqueId()))
        .ifPresent(
            _ -> {
              if (event.hasChangedPosition()) {
                var to = event.getFrom().clone();
                to.setYaw(event.getTo().getYaw());
                to.setPitch(event.getTo().getPitch());
                event.setTo(to);
              }
            });
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void interact(PlayerInteractEvent event) {
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    of(event.getPlayer()).ifPresent(runner -> interactPlayer(runner, event));
  }

  private static void interactPlayer(SurvivalRunner runner, PlayerInteractEvent event) {
    var player = event.getPlayer();
    if (runner.downed(player.getUniqueId())) {
      event.setCancelled(true);
      return;
    }
    interruptInteraction(runner, event);
    var right =
        event.getAction() == Action.RIGHT_CLICK_AIR
            || event.getAction() == Action.RIGHT_CLICK_BLOCK;
    if (right && guide(runner, event)) {
      event.setCancelled(true);
      runner.guide().open(player);
      return;
    }
    if (right && runner.items().ability(player.getInventory().getItemInMainHand())) {
      event.setCancelled(true);
      useCompass(runner, player);
      return;
    }
    if (event.getAction() == Action.RIGHT_CLICK_AIR
        && (runner.relics().anchor(player)
            || runner.legendary().staff(player)
            || runner.legendary().dash(player))) {
      event.setCancelled(true);
      return;
    }
    if (right && runner.isFighter(player.getUniqueId()))
      runner.legendary().repeater().begin(player);
    interactBlock(runner, event);
  }

  private static boolean guide(SurvivalRunner runner, PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    return block != null && runner.map().content().lobbyGuide().equals(Places.pos(block));
  }

  private static void useCompass(SurvivalRunner runner, Player player) {
    if (!runner.running()) runner.classMenus().classes(player);
    else if (player.isSneaking()) runner.classMenus().upgrades(player);
    else runner.actions().ability(player);
  }

  private static void interactBlock(SurvivalRunner runner, PlayerInteractEvent event) {
    var player = event.getPlayer();
    var block = event.getClickedBlock();
    if (block == null
        || event.getAction() != Action.RIGHT_CLICK_BLOCK
        || !runner.isFighter(player.getUniqueId())) {
      return;
    }
    var pos = Places.pos(block);
    if (Places.at(player).distanceSquared(block.getLocation()) > 36) return;
    runner.interrupted(player.getUniqueId());
    if (runner.machines().interact(player, pos)) {
      event.setCancelled(true);
      return;
    }
    if (runner
        .combat()
        .boss()
        .filter(
            b ->
                b.objective(
                    player,
                    pos,
                    runner.context().time().instant(),
                    () -> runner.combat().hit(b.entity(), player)))
        .isPresent()) {
      event.setCancelled(true);
      return;
    }
    runner
        .map()
        .gate(pos)
        .ifPresent(
            zone -> {
              event.setCancelled(true);
              runner.actions().unlock(player, zone, pos);
            });
    runner
        .map()
        .station(pos)
        .ifPresent(
            station -> {
              event.setCancelled(true);
              runner.menus().open(player, station);
            });
    runner
        .map()
        .resource(pos)
        .ifPresent(
            resource -> {
              event.setCancelled(true);
              if (player.isSneaking()) runner.menus().resource(player, resource);
              else runner.actions().gather(player, resource);
            });
    runner
        .map()
        .defense(pos)
        .ifPresent(
            defense -> {
              event.setCancelled(true);
              runner.actions().repair(player, defense);
            });
    if (runner.map().gate(pos).isEmpty()
        && runner.map().station(pos).isEmpty()
        && runner.map().resource(pos).isEmpty()
        && runner.map().defense(pos).isEmpty()
        && (runner.relics().anchor(player)
            || runner.legendary().staff(player)
            || runner.legendary().dash(player))) event.setCancelled(true);
  }

  private static void interruptInteraction(SurvivalRunner runner, PlayerInteractEvent event) {
    if (runner.isFighter(event.getPlayer().getUniqueId())
        && (event.getAction() == Action.RIGHT_CLICK_AIR
            || event.getAction() == Action.RIGHT_CLICK_BLOCK
            || event.getAction() == Action.LEFT_CLICK_AIR
            || event.getAction() == Action.LEFT_CLICK_BLOCK))
      runner.interrupted(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void click(InventoryClickEvent event) {
    if (event.getWhoClicked() instanceof Player player)
      of(player).ifPresent(runner -> click(runner, event, player));
  }

  private static void click(SurvivalRunner runner, InventoryClickEvent event, Player player) {
    if (protectedSlot(runner, event, player)) {
      event.setCancelled(true);
      return;
    }
    var top = event.getView().getTopInventory();
    if (!runner.classMenus().isMenu(top) && !runner.menus().isMenu(top)) return;
    if (player.getInventory().equals(event.getClickedInventory())) {
      rearrange(runner, event, player);
      return;
    }
    event.setCancelled(true);
    if (event.getClick() != org.bukkit.event.inventory.ClickType.LEFT
        && event.getClick() != org.bukkit.event.inventory.ClickType.RIGHT) return;
    if (runner.classMenus().isMenu(top)) runner.classMenus().click(player, top, event.getRawSlot());
    else if (event.getClickedInventory() != null)
      runner.menus().click(player, top, event.getRawSlot());
  }

  private static boolean protectedSlot(
      SurvivalRunner runner, InventoryClickEvent event, Player player) {
    var item = event.getCurrentItem();
    return runner.downed(player.getUniqueId())
        || (player.getInventory().equals(event.getClickedInventory()) && event.getSlot() == 8)
        || event.getHotbarButton() == 8
        || runner.items().ability(event.getCursor())
        || (item != null && runner.items().ability(item));
  }

  private static void rearrange(SurvivalRunner runner, InventoryClickEvent event, Player player) {
    if (event.isShiftClick()) {
      event.setCancelled(true);
      var top = event.getView().getTopInventory();
      if (runner.menus().isMenu(top)) runner.menus().store(player, top, event.getSlot());
    } else if (event.getAction() == org.bukkit.event.inventory.InventoryAction.COLLECT_TO_CURSOR)
      event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void drag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      of(player)
          .filter(
              r ->
                  ((r.menus().isMenu(event.getView().getTopInventory())
                              || r.classMenus().isMenu(event.getView().getTopInventory()))
                          && event.getRawSlots().stream()
                              .anyMatch(slot -> slot < event.getView().getTopInventory().getSize()))
                      || event
                          .getRawSlots()
                          .contains(event.getView().getTopInventory().getSize() + 27 + 8)
                      || r.items().ability(event.getOldCursor())
                      || r.downed(player.getUniqueId()))
          .ifPresent(_ -> event.setCancelled(true));
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void craft(CraftItemEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      of(player).ifPresent(_ -> event.setCancelled(true));
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void shoot(EntityShootBowEvent event) {
    if (event.getEntity() instanceof Player player)
      of(player).ifPresent(runner -> shootPlayer(event, player, runner));
  }

  private static void shootPlayer(EntityShootBowEvent event, Player player, SurvivalRunner runner) {
    runner.interrupted(player.getUniqueId());
    if (!runner.isFighter(player.getUniqueId())) {
      event.setCancelled(true);
      return;
    }
    var weapon = event.getBow();
    if (weapon != null && runner.legendary().repeater().owns(weapon)) {
      runner.legendary().repeater().cancelVanilla(event, player);
      return;
    }
    var factor = weapon == null ? 1 : runner.items().multiplier(weapon);
    if (runner.game().player(player.getUniqueId()).orElseThrow().role()
        == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass.RANGER) factor *= 1.1;
    if (event.getProjectile() instanceof Projectile projectile) {
      factor *= runner.talents().shot(player, projectile);
      runner.combat().projectile(projectile, factor);
      if (weapon != null) runner.legendary().launched(projectile, weapon);
      if (weapon != null) runner.relics().shot(player, projectile, weapon, event.getForce());
    }
    if (event.getProjectile() instanceof org.bukkit.entity.AbstractArrow arrow)
      arrow.setPickupStatus(org.bukkit.entity.AbstractArrow.PickupStatus.DISALLOWED);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void stopUsing(io.papermc.paper.event.player.PlayerStopUsingItemEvent event) {
    of(event.getPlayer())
        .ifPresent(
            runner -> {
              runner.legendary().repeater().stop(event.getPlayer().getUniqueId());
              runner.relics().release(event.getPlayer());
            });
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void held(org.bukkit.event.player.PlayerItemHeldEvent event) {
    of(event.getPlayer())
        .ifPresent(runner -> runner.legendary().repeater().stop(event.getPlayer().getUniqueId()));
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void drop(org.bukkit.event.player.PlayerDropItemEvent event) {
    of(event.getPlayer())
        .filter(r -> r.items().ability(event.getItemDrop().getItemStack()))
        .ifPresent(_ -> event.setCancelled(true));
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void swap(org.bukkit.event.player.PlayerSwapHandItemsEvent event) {
    of(event.getPlayer())
        .filter(
            r ->
                r.items().ability(event.getMainHandItem())
                    || r.items().ability(event.getOffHandItem()))
        .ifPresent(_ -> event.setCancelled(true));
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void pickup(org.bukkit.event.player.PlayerPickupArrowEvent event) {
    if (event.getArrow() instanceof org.bukkit.entity.Trident trident)
      of(event.getPlayer())
          .filter(r -> r.tridents().pickup(event.getPlayer(), trident))
          .ifPresent(_ -> event.setCancelled(true));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void blocked(EntityDamageByEntityEvent event) {
    if (event.getEntity() instanceof Player player
        && player.isBlocking()
        && event.getFinalDamage() == 0)
      of(player)
          .filter(r -> r.world().isWaveMob(damageSource(event.getDamager())))
          .ifPresent(
              r -> {
                r.boons().block(player);
                r.relics().block(player, event.getDamage());
              });
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void shieldDisabled(io.papermc.paper.event.player.PlayerShieldDisableEvent event) {
    of(event.getPlayer())
        .ifPresent(
            r -> {
              var player = event.getPlayer();
              var held = player.getInventory().getItemInMainHand();
              var shield =
                  held.getType() == org.bukkit.Material.SHIELD
                      ? held
                      : player.getInventory().getItemInOffHand();
              if (r.items().equipment(shield))
                event.setCooldown(
                    (int) Math.ceil(event.getCooldown() * (1 - .1 * r.items().tier(shield))));
            });
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void healed(org.bukkit.event.entity.EntityRegainHealthEvent event) {
    if (event.getEntity() instanceof Player player && event.getAmount() > 0)
      of(player)
          .filter(r -> r.isFighter(player.getUniqueId()))
          .ifPresent(r -> r.boons().healing(player));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void suffered(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player && event.getFinalDamage() > 0)
      of(player).ifPresent(r -> r.relics().suffered(player));
  }
}
