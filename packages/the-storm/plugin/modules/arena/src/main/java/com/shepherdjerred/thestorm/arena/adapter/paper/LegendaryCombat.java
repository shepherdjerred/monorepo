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
  private final Map<UUID, Integer> packedThrows = new HashMap<>();
  private final Map<UUID, Instant> staffReady = new HashMap<>();
  private final Map<UUID, Instant> meleeReady = new HashMap<>();
  private final Map<UUID, Instant> dashReady = new HashMap<>();
  private final RepeaterCombat repeater;

  LegendaryCombat(SurvivalRunner runner) {
    this.runner = runner;
    repeater = new RepeaterCombat(runner);
  }

  RepeaterCombat repeater() {
    return repeater;
  }

  void launched(Projectile projectile, ItemStack weapon) {
    if (projectile instanceof org.bukkit.entity.Trident && runner.items().tier(weapon) >= 2)
      packedThrows.put(projectile.getUniqueId(), runner.items().tier(weapon));
    if (runner.items().tier(weapon) >= 2
        && projectile instanceof org.bukkit.entity.AbstractArrow arrow)
      arrow.setPierceLevel(Math.max(1, arrow.getPierceLevel()));
    runner
        .items()
        .legendary(weapon)
        .ifPresent(
            id -> shots.put(projectile.getUniqueId(), new Shot(id, runner.items().tier(weapon))));
  }

  void hit(Player player, LivingEntity target, Projectile projectile) {
    var shot = shots.get(projectile.getUniqueId());
    if (runner.combat().scriptedDamage() || !runner.world().isWaveMob(target)) return;
    var packed = packedThrows.get(projectile.getUniqueId());
    if (shot == null) {
      if (packed != null) shock(player, target, 2 * multiplier(packed));
      return;
    }
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
    if (shot.type() == LegendaryWeapon.STORMCALLER || shot.type() == LegendaryWeapon.TIDEBREAKER) {
      nearby
          .limit(2)
          .forEach(
              e -> {
                e.getWorld()
                    .spawnParticle(
                        shot.type() == LegendaryWeapon.TIDEBREAKER
                            ? Particle.BUBBLE_POP
                            : Particle.ELECTRIC_SPARK,
                        e.getLocation().add(0, 1, 0),
                        12,
                        .3,
                        .4,
                        .3,
                        .02);
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

  void melee(Player player, LivingEntity target) {
    if (runner.combat().scriptedDamage()
        || !runner.world().isWaveMob(target)
        || !runner.isFighter(player.getUniqueId())) return;
    var weapon = player.getInventory().getItemInMainHand();
    var whirlwind =
        runner.items().legendary(weapon).filter(id -> id == LegendaryWeapon.WHIRLWIND).isPresent();
    var material = weapon.getType().name();
    var packed =
        runner.items().tier(weapon) >= 2
            && runner.items().weapon(weapon)
            && (material.endsWith("_AXE")
                || material.endsWith("_SWORD")
                || material.endsWith("_SPEAR")
                || material.equals("MACE"));
    if (!whirlwind && !packed) return;
    var now = runner.context().time().instant();
    if (now.isBefore(meleeReady.getOrDefault(player.getUniqueId(), Instant.MIN))) return;
    meleeReady.put(player.getUniqueId(), now.plusSeconds(2));
    runner.world().enemies().stream()
        .filter(
            enemy ->
                !enemy.equals(target)
                    && enemy.getLocation().distanceSquared(target.getLocation()) <= 9
                    && player.hasLineOfSight(enemy)
                    && target.hasLineOfSight(enemy))
        .sorted(
            java.util.Comparator.comparingDouble(
                enemy -> enemy.getLocation().distanceSquared(target.getLocation())))
        .limit(2)
        .forEach(
            enemy ->
                runner
                    .combat()
                    .damage(
                        enemy, player, (whirlwind ? 4 : 2) * runner.items().multiplier(weapon)));
    player.getWorld().spawnParticle(Particle.SWEEP_ATTACK, target.getLocation().add(0, 1, 0), 1);
  }

  private void shock(Player player, LivingEntity target, double damage) {
    runner.world().enemies().stream()
        .filter(
            enemy ->
                !enemy.equals(target)
                    && enemy.getLocation().distanceSquared(target.getLocation()) <= 16
                    && player.hasLineOfSight(enemy)
                    && target.hasLineOfSight(enemy))
        .sorted(
            java.util.Comparator.comparingDouble(
                enemy -> enemy.getLocation().distanceSquared(target.getLocation())))
        .limit(2)
        .forEach(enemy -> runner.combat().damage(enemy, player, damage));
    target
        .getWorld()
        .spawnParticle(Particle.BUBBLE_POP, target.getLocation().add(0, 1, 0), 20, .5, .5, .5, .02);
  }

  boolean dash(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    if (runner.items().legendary(weapon).filter(id -> id == LegendaryWeapon.RIFTBLADE).isEmpty())
      return false;
    var now = runner.context().time().instant();
    if (!runner.isFighter(player.getUniqueId())
        || now.isBefore(dashReady.getOrDefault(player.getUniqueId(), Instant.MIN))) {
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      return true;
    }
    var step = player.getEyeLocation().getDirection().setY(0);
    if (step.lengthSquared() < .01) return true;
    step.normalize().multiply(.5);
    var start = Places.at(player);
    var destination = start.clone();
    for (var distance = 0; distance < 8; distance++) {
      var candidate = destination.clone().add(step);
      if (!safe(candidate)) break;
      destination = candidate;
    }
    if (destination.distanceSquared(start) < .25 || !player.teleport(destination)) {
      Texts.info(player, "Find open ground for your dash.");
      return true;
    }
    dashReady.put(player.getUniqueId(), now.plusSeconds(6));
    player.getWorld().spawnParticle(Particle.PORTAL, start.add(0, 1, 0), 24, .4, .5, .4, .03);
    runner.feedback().play(player, SurvivalFeedback.Cue.ABILITY);
    return true;
  }

  private boolean safe(org.bukkit.Location candidate) {
    for (var x : new double[] {-.3, .3}) {
      for (var z : new double[] {-.3, .3}) {
        var at = candidate.clone().add(x, 0, z);
        if (!runner.map().combat(at)
            || !at.getBlock().isPassable()
            || !at.clone().add(0, 1, 0).getBlock().isPassable()
            || !at.clone().subtract(0, .1, 0).getBlock().isCollidable()) return false;
      }
    }
    return true;
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
    packedThrows.keySet().removeIf(id -> runner.context().server().getEntity(id) == null);
  }

  void leave(UUID id) {
    staffReady.remove(id);
    meleeReady.remove(id);
    dashReady.remove(id);
    repeater.stop(id);
  }

  void reset() {
    shots.clear();
    packedThrows.clear();
    staffReady.clear();
    meleeReady.clear();
    dashReady.clear();
    repeater.reset();
  }
}
