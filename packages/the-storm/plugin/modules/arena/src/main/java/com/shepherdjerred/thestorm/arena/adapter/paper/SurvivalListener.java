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
        .filter(r -> r.world().owns(event.getEntity()))
        .forEach(
            runner ->
                runner
                    .combat()
                    .died(
                        event.getEntity(),
                        runner.game().participants().stream()
                            .map(p -> p.id())
                            .collect(java.util.stream.Collectors.toUnmodifiableSet())));
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
              if (block == null
                  || event.getAction() != Action.RIGHT_CLICK_BLOCK
                  || !runner.isFighter(player.getUniqueId())) {
                return;
              }
              var pos = Places.pos(block);
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
                        runner.actions().unlock(player, zone);
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
    if (event.getEntity() instanceof Player player) {
      of(player)
          .ifPresent(
              runner -> {
                runner.interrupted(player.getUniqueId());
                if (!runner.isFighter(player.getUniqueId())) {
                  event.setCancelled(true);
                } else if (event.getProjectile() instanceof org.bukkit.entity.AbstractArrow arrow) {
                  arrow.setPickupStatus(org.bukkit.entity.AbstractArrow.PickupStatus.DISALLOWED);
                }
              });
    }
  }
}
