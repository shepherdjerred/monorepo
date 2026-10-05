package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;

/** Equipment signatures are bounded, owner-driven effects with cooldowns that survive swaps. */
final class RelicCombat {
  private static final class State {
    final Map<LegendaryWeapon, Instant> cooldowns = new EnumMap<>(LegendaryWeapon.class);
    int stormHits;
    double echoes;
    double blocked;
    @Nullable Location anchor;
    Instant anchorExpires = Instant.MIN;
    @Nullable Location trail;
  }

  private record Shot(boolean storm) {}

  private record Injury(double before, double absorption, @Nullable ItemStack chest) {}

  private final SurvivalRunner runner;
  private final Map<UUID, State> states = new HashMap<>();
  private final Map<UUID, Shot> shots = new HashMap<>();
  private final Map<UUID, Injury> injuries = new HashMap<>();

  RelicCombat(SurvivalRunner runner) {
    this.runner = runner;
  }

  private State state(Player player) {
    return states.computeIfAbsent(player.getUniqueId(), _ -> new State());
  }

  private boolean effect(ItemStack item, LegendaryWeapon effect) {
    return runner.items().legendary(item).filter(id -> id == effect).isPresent();
  }

  private boolean ready(Player player, LegendaryWeapon effect) {
    return !runner
        .context()
        .time()
        .instant()
        .isBefore(state(player).cooldowns.getOrDefault(effect, Instant.MIN));
  }

  private void cooldown(Player player, LegendaryWeapon effect, int seconds) {
    state(player).cooldowns.put(effect, runner.context().time().instant().plusSeconds(seconds));
  }

  void shot(Player player, Projectile projectile, ItemStack gear, float force) {
    if (force < .95 || !effect(gear, LegendaryWeapon.STORMGLASS)) return;
    var state = state(player);
    var storm =
        state.stormHits >= 3
            && ready(player, LegendaryWeapon.STORMGLASS)
            && runner.items().spend(player, Map.of("REDSTONE", 2));
    if (storm) {
      state.stormHits = 0;
      cooldown(player, LegendaryWeapon.STORMGLASS, 10);
      cue(player, Particle.ELECTRIC_SPARK, "Stormglass · storm shot released");
    }
    shots.put(projectile.getUniqueId(), new Shot(storm));
  }

  void hit(Player player, LivingEntity target, Projectile projectile) {
    if (runner.combat().scriptedDamage() || !runner.world().isWaveMob(target)) return;
    var shot = shots.remove(projectile.getUniqueId());
    if (shot == null) return;
    if (shot.storm()) {
      nearby(player, target.getLocation(), 5)
          .limit(5)
          .forEach(enemy -> runner.combat().damage(enemy, player, 12));
      target
          .getWorld()
          .spawnParticle(
              Particle.ELECTRIC_SPARK, target.getLocation().add(0, 1, 0), 40, 2, .8, 2, .03);
    } else {
      var state = state(player);
      state.stormHits = Math.min(3, state.stormHits + 1);
      runner
          .hud()
          .hint(
              player,
              "Stormglass · " + state.stormHits + "/3 charge · next storm costs 2 redstone",
              2);
    }
  }

  void block(Player player, double damage) {
    var shield = player.getInventory().getItemInMainHand();
    if (shield.getType() != org.bukkit.Material.SHIELD)
      shield = player.getInventory().getItemInOffHand();
    if (effect(shield, LegendaryWeapon.COPPERGUARD) && ready(player, LegendaryWeapon.COPPERGUARD)) {
      cooldown(player, LegendaryWeapon.COPPERGUARD, 6);
      nearby(player, Places.at(player), 4)
          .limit(2)
          .forEach(enemy -> runner.combat().damage(enemy, player, 3));
      cue(player, Particle.ELECTRIC_SPARK, "Copperguard · defensive arc");
    }
    if (effect(shield, LegendaryWeapon.FAULTLINE)) {
      var state = state(player);
      state.blocked = Math.min(12, state.blocked + Math.max(0, damage));
      runner
          .hud()
          .hint(
              player,
              "Faultline · " + (int) state.blocked + " stored · release shield to erupt",
              2);
    }
  }

  void release(Player player) {
    var state = state(player);
    if (!runner.isFighter(player.getUniqueId())
        || state.blocked <= 0
        || !ready(player, LegendaryWeapon.FAULTLINE)) return;
    if (!effect(player.getInventory().getItemInMainHand(), LegendaryWeapon.FAULTLINE)
        && !effect(player.getInventory().getItemInOffHand(), LegendaryWeapon.FAULTLINE)) return;
    var damage = state.blocked;
    state.blocked = 0;
    cooldown(player, LegendaryWeapon.FAULTLINE, 12);
    var direction = Places.at(player).getDirection().setY(0);
    if (direction.lengthSquared() < .01) return;
    direction.normalize();
    nearby(player, Places.at(player), 6)
        .filter(
            enemy -> {
              var vector =
                  enemy.getLocation().toVector().subtract(Places.at(player).toVector()).setY(0);
              return vector.lengthSquared() < .01 || vector.normalize().dot(direction) >= .5;
            })
        .limit(6)
        .forEach(enemy -> runner.combat().damage(enemy, player, damage));
    cue(player, Particle.WAX_OFF, "Faultline · stored force released");
  }

  void suffered(Player player) {
    var id = player.getUniqueId();
    if (injuries.containsKey(id)) return;
    var chest = player.getInventory().getChestplate();
    injuries.put(
        id,
        new Injury(
            player.getHealth() + player.getAbsorptionAmount(),
            player.getAbsorptionAmount(),
            chest == null ? null : chest.clone()));
    runner
        .context()
        .scheduler()
        .runOnMainThreadLater(java.time.Duration.ofMillis(50), () -> settle(player));
  }

  private void settle(Player player) {
    var injury = injuries.remove(player.getUniqueId());
    if (injury == null || !runner.isFighter(player.getUniqueId())) return;
    runner
        .wards()
        .absorbed(player, Math.max(0, injury.absorption() - player.getAbsorptionAmount()));
    var chest = injury.chest();
    if (chest != null)
      hurt(
          player,
          chest,
          Math.max(0, injury.before() - player.getHealth() - player.getAbsorptionAmount()));
  }

  private void hurt(Player player, ItemStack chest, double actual) {
    if (actual <= 0) return;
    if (effect(chest, LegendaryWeapon.ECHOHEART))
      state(player).echoes = Math.min(12, state(player).echoes + actual);
    if (effect(chest, LegendaryWeapon.BRIARPLATE) && ready(player, LegendaryWeapon.BRIARPLATE)) {
      cooldown(player, LegendaryWeapon.BRIARPLATE, 8);
      nearby(player, Places.at(player), 4)
          .filter(enemy -> !runner.combat().bossEntity(enemy))
          .limit(3)
          .forEach(
              enemy -> enemy.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, 40, 0)));
      cue(player, Particle.HAPPY_VILLAGER, "Briarplate · brambles slow your pursuers");
    }
  }

  void ability(Player player) {
    var state = state(player);
    var chest = player.getInventory().getChestplate();
    if (state.echoes <= 0 || chest == null || !effect(chest, LegendaryWeapon.ECHOHEART)) return;
    var ward = Math.min(6, state.echoes / 2);
    state.echoes = 0;
    runner.fighters().stream()
        .filter(ally -> Places.at(ally).distanceSquared(Places.at(player)) <= 64)
        .forEach(ally -> runner.wards().grant(ally, SurvivalWards.Source.ECHOHEART, ward, 8));
    cue(player, Particle.SOUL, "Echoheart · remembered pain becomes a team ward");
  }

  boolean anchor(Player player) {
    if (!runner.isFighter(player.getUniqueId())
        || !effect(player.getInventory().getItemInMainHand(), LegendaryWeapon.WAYFARER))
      return false;
    var state = state(player);
    var now = runner.context().time().instant();
    var anchor = state.anchor;
    if (anchor != null && now.isBefore(state.anchorExpires)) {
      if (!safe(anchor)) {
        Texts.error(player, "Your anchor is obstructed. Clear it before returning.");
        return true;
      }
      state.anchor = null;
      player.teleport(anchor);
      player.setFallDistance(0);
      nearby(player, anchor, 4).limit(5).forEach(enemy -> runner.combat().damage(enemy, player, 8));
      cue(player, Particle.PORTAL, "Wayfarer · returned to your anchor");
      return true;
    }
    if (!ready(player, LegendaryWeapon.WAYFARER) || !safe(Places.at(player))) return true;
    if (!runner.items().spend(player, Map.of("REDSTONE", 2))) return true;
    state.anchor = Places.at(player).clone();
    state.anchorExpires = now.plusSeconds(5);
    cooldown(player, LegendaryWeapon.WAYFARER, 20);
    cue(player, Particle.PORTAL, "Wayfarer · anchor lasts five seconds · right-click to return");
    return true;
  }

  private boolean safe(Location at) {
    if (!runner.map().combat(at)) return false;
    for (var x : new double[] {-.3, .3})
      for (var z : new double[] {-.3, .3}) {
        var point = at.clone().add(x, 0, z);
        if (!point.getBlock().isPassable()
            || !point.clone().add(0, 1, 0).getBlock().isPassable()
            || !point.clone().subtract(0, .1, 0).getBlock().isCollidable()) return false;
      }
    return runner
        .combat()
        .boss()
        .flatMap(SurvivalBoss::cast)
        .filter(cast -> cast.hits(Places.point(at)))
        .isEmpty();
  }

  void tick() {
    shots.keySet().removeIf(id -> runner.context().server().getEntity(id) == null);
    runner.fighters().forEach(this::tick);
  }

  private void tick(Player player) {
    var state = state(player);
    var now = runner.context().time().instant();
    var anchor = state.anchor;
    if (anchor != null) {
      if (!now.isBefore(state.anchorExpires)) state.anchor = null;
      else player.spawnParticle(Particle.PORTAL, anchor.clone().add(0, .3, 0), 3, .4, .2, .4, 0);
    }
    var boots = player.getInventory().getBoots();
    if (boots != null
        && effect(boots, LegendaryWeapon.TRAILWARDEN)
        && player.isSprinting()
        && ready(player, LegendaryWeapon.TRAILWARDEN)) {
      state.trail = Places.at(player).clone();
      cooldown(player, LegendaryWeapon.TRAILWARDEN, 3);
    }
    var trail = state.trail;
    if (trail != null) {
      if (ready(player, LegendaryWeapon.TRAILWARDEN)) state.trail = null;
      else {
        player.spawnParticle(Particle.HAPPY_VILLAGER, trail, 2, .6, .1, .6, 0);
        nearby(player, trail, 2)
            .filter(enemy -> !runner.combat().bossEntity(enemy))
            .limit(3)
            .forEach(
                enemy -> enemy.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, 40, 0)));
      }
    }
  }

  private java.util.stream.Stream<LivingEntity> nearby(Player player, Location at, double radius) {
    return runner.world().enemies().stream()
        .filter(
            enemy ->
                enemy.isValid()
                    && !enemy.isDead()
                    && enemy.getLocation().distanceSquared(at) <= radius * radius
                    && player.hasLineOfSight(enemy))
        .sorted(
            java.util.Comparator.comparingDouble(enemy -> enemy.getLocation().distanceSquared(at)));
  }

  private void cue(Player player, Particle particle, String hint) {
    player.getWorld().spawnParticle(particle, Places.at(player).add(0, 1, 0), 16, .6, .5, .6, .03);
    runner.hud().hint(player, hint, 3);
  }

  void leave(UUID id) {
    states.remove(id);
    injuries.remove(id);
  }

  void reset() {
    states.clear();
    shots.clear();
    injuries.clear();
  }
}
