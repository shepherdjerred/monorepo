package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Conditional shrine boons. Timers belong to the survivor, so swapping cannot reset them. */
final class SurvivalBoons {
  private static final class State {
    final Map<SurvivalPerk, Instant> cooldowns = new EnumMap<>(SurvivalPerk.class);
    Location last;
    double sprint;
    boolean armed;
    boolean ranged;
    Instant hit = Instant.MIN;

    State(Location last) {
      this.last = last;
    }
  }

  private final SurvivalRunner runner;
  private final Map<UUID, State> states = new HashMap<>();

  SurvivalBoons(SurvivalRunner runner) {
    this.runner = runner;
  }

  private State state(Player player) {
    return states.computeIfAbsent(player.getUniqueId(), _ -> new State(Places.at(player).clone()));
  }

  private boolean ready(Player player, SurvivalPerk boon, int seconds) {
    var now = runner.context().time().instant();
    var state = state(player);
    if (!runner.actions().has(player, boon)
        || now.isBefore(state.cooldowns.getOrDefault(boon, Instant.MIN))) return false;
    state.cooldowns.put(boon, now.plusSeconds(seconds));
    return true;
  }

  void tick() {
    runner.online().forEach(this::tick);
  }

  private void tick(Player player) {
    var state = state(player);
    var at = Places.at(player);
    var now = runner.context().time().instant();
    if (runner.actions().has(player, SurvivalPerk.GALESTRIDE)
        && player.isSprinting()
        && at.getWorld().equals(state.last.getWorld())) {
      var distance = at.distance(state.last);
      if (distance < 2) state.sprint += distance;
      if (state.sprint >= 8
          && !now.isBefore(state.cooldowns.getOrDefault(SurvivalPerk.GALESTRIDE, Instant.MIN)))
        state.armed = true;
    } else state.sprint = 0;
    state.last = at.clone();
  }

  void block(Player player) {
    if (!ready(player, SurvivalPerk.STONEWARD, 10)) return;
    runner.wards().grant(player, SurvivalWards.Source.STONEWARD, 4, 4);
    cue(player, Particle.WAX_ON, "Stoneward · shield ward");
  }

  void hit(Player player, LivingEntity target, boolean ranged) {
    if (!runner.world().isWaveMob(target) || runner.combat().scriptedDamage()) return;
    var state = state(player);
    if (state.armed && ready(player, SurvivalPerk.GALESTRIDE, 8)) {
      state.armed = false;
      state.sprint = 0;
      var push = target.getLocation().toVector().subtract(Places.at(player).toVector());
      if (!runner.combat().bossEntity(target) && push.lengthSquared() > .01)
        target.setVelocity(push.normalize().multiply(.7).setY(.2));
      player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 40, 0));
      cue(player, Particle.CLOUD, "Galestride · swift strike");
    }
    var now = runner.context().time().instant();
    if (state.ranged != ranged
        && now.isBefore(state.hit.plusSeconds(4))
        && ready(player, SurvivalPerk.EMBERWEAVE, 6)) {
      runner.world().enemies().stream()
          .filter(
              enemy ->
                  enemy.getLocation().distanceSquared(target.getLocation()) <= 9
                      && player.hasLineOfSight(enemy))
          .limit(3)
          .forEach(enemy -> runner.combat().damage(enemy, player, 3));
      cue(player, Particle.SMALL_FLAME, "Emberweave · cinder burst");
    }
    state.ranged = ranged;
    state.hit = now;
  }

  void healing(Player player) {
    if (!ready(player, SurvivalPerk.SOULBOND, 10)) return;
    var ally =
        runner.fighters().stream()
            .filter(p -> !p.equals(player))
            .filter(p -> Places.at(p).distanceSquared(Places.at(player)) <= 64)
            .min(java.util.Comparator.comparingDouble(Player::getHealth));
    if (ally.isPresent()) SurvivalItems.heal(ally.orElseThrow(), 2);
    else runner.wards().grant(player, SurvivalWards.Source.SOULBOND, 2, 10);
    cue(player, Particle.HEART, "Soulbond · shared vitality");
  }

  private void cue(Player player, Particle particle, String message) {
    player.getWorld().spawnParticle(particle, Places.at(player).add(0, 1, 0), 12, .4, .4, .4, .02);
    runner.hud().hint(player, message, 2);
  }

  void leave(UUID id) {
    states.remove(id);
  }

  void reset() {
    states.clear();
  }
}
