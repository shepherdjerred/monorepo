package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Particle;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.inventory.ItemStack;

/** Successful native hits trigger bounded effects; deflected shots never bypass immunity. */
final class LegendaryCombat {
  private record Shot(LegendaryWeapon type, int tier) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Shot> shots = new HashMap<>();
  private final Map<UUID, Instant> staffReady = new HashMap<>();

  LegendaryCombat(SurvivalRunner runner) {
    this.runner = runner;
  }

  void launched(Projectile projectile, ItemStack weapon) {
    runner
        .items()
        .legendary(weapon)
        .ifPresent(
            id -> shots.put(projectile.getUniqueId(), new Shot(id, runner.items().tier(weapon))));
  }

  void hit(Player player, LivingEntity target, Projectile projectile) {
    var shot = shots.get(projectile.getUniqueId());
    if (shot == null || runner.combat().scriptedDamage() || !runner.world().isWaveMob(target))
      return;
    var nearby =
        runner.world().enemies().stream()
            .filter(
                e ->
                    !e.equals(target)
                        && e.getLocation().distanceSquared(target.getLocation()) <= 16
                        && target.hasLineOfSight(e)
                        && player.hasLineOfSight(e))
            .sorted(
                java.util.Comparator.comparingDouble(
                    e -> e.getLocation().distanceSquared(target.getLocation())));
    if (shot.type() == LegendaryWeapon.STORMCALLER) {
      nearby
          .limit(2)
          .forEach(
              e -> {
                e.getWorld()
                    .spawnParticle(
                        Particle.ELECTRIC_SPARK, e.getLocation().add(0, 1, 0), 12, .3, .4, .3, .02);
                runner.combat().damage(e, player, 4 * multiplier(shot.tier()));
              });
    } else if (shot.type() == LegendaryWeapon.FROSTBITE) {
      java.util.stream.Stream.concat(java.util.stream.Stream.of(target), nearby)
          .filter(e -> !runner.combat().bossEntity(e))
          .limit(4)
          .forEach(
              e -> {
                e.addPotionEffect(
                    new org.bukkit.potion.PotionEffect(
                        org.bukkit.potion.PotionEffectType.SLOWNESS,
                        (int) Math.round(60 * multiplier(shot.tier())),
                        1));
                e.getWorld()
                    .spawnParticle(
                        Particle.SNOWFLAKE, e.getLocation().add(0, 1, 0), 10, .3, .4, .3, .01);
              });
    }
  }

  boolean staff(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    if (runner.items().legendary(weapon).filter(id -> id == LegendaryWeapon.GRAVITON).isEmpty())
      return false;
    var now = runner.context().time().instant();
    if (!runner.isFighter(player.getUniqueId())
        || now.isBefore(staffReady.getOrDefault(player.getUniqueId(), Instant.MIN))) {
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      Texts.info(player, "Graviton recharges in five seconds.");
      return true;
    }
    var block = player.getTargetBlockExact(12);
    var aim =
        block == null
            ? player.getEyeLocation().add(player.getEyeLocation().getDirection().multiply(12))
            : block.getLocation().add(.5, 1, .5);
    if (!runner.map().combat(aim)) {
      Texts.error(player, "Aim at an open combat route within twelve blocks.");
      return true;
    }
    if (!runner.items().spend(player, Map.of("REDSTONE", 1))) return true;
    staffReady.put(player.getUniqueId(), now.plusSeconds(5));
    var radius = 4 + runner.items().tier(weapon);
    runner.world().enemies().stream()
        .filter(
            e ->
                !runner.combat().bossEntity(e)
                    && e.getLocation().distanceSquared(aim) <= radius * radius
                    && player.hasLineOfSight(e))
        .sorted(java.util.Comparator.comparingDouble(e -> e.getLocation().distanceSquared(aim)))
        .limit(5)
        .forEach(
            e -> {
              var pull = aim.toVector().subtract(e.getLocation().toVector());
              if (pull.lengthSquared() > .01)
                e.setVelocity(pull.normalize().multiply(1.1).setY(.2));
              runner.combat().hit(e, player);
            });
    player.getWorld().spawnParticle(Particle.PORTAL, aim, 50, .8, .5, .8, .1);
    runner.feedback().play(player, SurvivalFeedback.Cue.ABILITY);
    return true;
  }

  private static double multiplier(int tier) {
    return switch (tier) {
      case 0 -> 1;
      case 1 -> 1.35;
      case 2 -> 1.70;
      case 3 -> 2.10;
      default -> throw new IllegalArgumentException("Invalid legendary tier");
    };
  }

  void tick() {
    shots.keySet().removeIf(id -> runner.context().server().getEntity(id) == null);
  }

  void leave(UUID id) {
    staffReady.remove(id);
  }

  void reset() {
    shots.clear();
    staffReady.clear();
  }
}
