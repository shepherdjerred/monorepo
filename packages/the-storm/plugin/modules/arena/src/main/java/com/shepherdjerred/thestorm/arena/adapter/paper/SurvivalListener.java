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

  private Optional<SurvivalRunner> of(Player player) {
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
              var factor =
                  event.getDamager() instanceof Projectile projectile
                      ? r.combat().projectileMultiplier(projectile)
                      : heldDamage(r, player);
              var instant = r.drops().instaKill() && !r.combat().bossEntity(target);
              event.setDamage(instant ? 10000 : event.getDamage() * factor);
            });
  }

  private static double heldDamage(SurvivalRunner runner, Player player) {
    return runner.items().multiplier(player.getInventory().getItemInMainHand())
        * (runner
                .actions()
                .has(
                    player,
                    com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.DOUBLE_TAP)
            ? 1.25
            : 1);
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
    if (runner
        .actions()
        .has(player, com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.DOUBLE_TAP))
      factor *= 1.25;
    runner.combat().projectile(trident, factor);
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
                      .ifPresent(
                          b -> {
                            var now = r.context().time().instant();
                            if (b.protectedNow(now)) {
                              event.setCancelled(true);
                            } else {
                              event.setDamage(event.getDamage() * b.damageMultiplier(now));
                            }
                          }));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void hit(EntityDamageByEntityEvent event) {
    Player player =
        switch (event.getDamager()) {
          case Player direct -> direct;
          case Projectile projectile when projectile.getShooter() instanceof Player shooter ->
              shooter;
          case Wolf wolf when wolf.getOwner() instanceof Player owner -> owner;
          default -> null;
        };
    if (player != null && event.getEntity() instanceof LivingEntity enemy) {
      of(player)
          .ifPresent(
              runner -> {
                runner.interrupted(player.getUniqueId());
                runner.combat().hit(enemy, player);
              });
    }
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
    of(event.getPlayer())
        .ifPresent(
            runner -> {
              var player = event.getPlayer();
              if (runner.downed(player.getUniqueId())) {
                event.setCancelled(true);
                return;
              }
              var block = event.getClickedBlock();
              interruptInteraction(runner, event);
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
                        runner.actions().gather(player, resource);
                      });
              runner
                  .map()
                  .defense(pos)
                  .ifPresent(
                      defense -> {
                        event.setCancelled(true);
                        runner.actions().repair(player, defense);
                      });
            });
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
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    of(player)
        .ifPresent(
            runner -> {
              if (runner.menus().isMenu(event.getView().getTopInventory())) {
                event.setCancelled(true);
                runner.menus().click(player, event.getView().getTopInventory(), event.getRawSlot());
              } else if (runner.downed(player.getUniqueId())) {
                event.setCancelled(true);
              }
            });
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void drag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      of(player)
          .filter(
              r ->
                  r.menus().isMenu(event.getView().getTopInventory())
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
    var factor = weapon == null ? 1 : runner.items().multiplier(weapon);
    if (runner
        .actions()
        .has(player, com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk.DOUBLE_TAP))
      factor *= 1.25;
    if (event.getProjectile() instanceof Projectile projectile)
      runner.combat().projectile(projectile, factor);
    if (event.getProjectile() instanceof org.bukkit.entity.AbstractArrow arrow)
      arrow.setPickupStatus(org.bukkit.entity.AbstractArrow.PickupStatus.DISALLOWED);
  }
}
