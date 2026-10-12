package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.Specialization;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalBuild;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Class identities and bounded effects use the ordinary encounter damage and restore paths. */
final class SurvivalTalents {
  private record Shots(Specialization type, int remaining, double factor, Instant until) {}

  private record Trap(Location at, double damage, Instant until) {}

  private record Corrosion(
      UUID owner, LivingEntity target, double damage, int remaining, Instant next) {}

  private final SurvivalRunner runner;
  private final Map<UUID, SurvivalBuild> builds = new HashMap<>();
  private final Map<UUID, Instant> cooldowns = new HashMap<>();
  private final Map<UUID, Instant> resonance = new HashMap<>();
  private final Map<UUID, Double> companionFactors = new HashMap<>();

  void resonate(Player player) {
    var now = runner.context().time().instant();
    var due = cooldowns.getOrDefault(player.getUniqueId(), now);
    if (now.isBefore(due))
      cooldowns.put(
          player.getUniqueId(), now.plus(java.time.Duration.between(now, due).dividedBy(2)));
    resonance.put(player.getUniqueId(), now.plusSeconds(15));
  }

  private final Map<UUID, Shots> shots = new HashMap<>();
  private final Map<UUID, Trap> traps = new HashMap<>();
  private final Map<UUID, Corrosion> corrosion = new HashMap<>();

  SurvivalTalents(SurvivalRunner runner) {
    this.runner = runner;
  }

  SurvivalBuild build(UUID id) {
    var role = runner.game().player(id).orElseThrow().role();
    var existing = builds.get(id);
    if (existing == null || existing.role() != role) {
      existing = new SurvivalBuild(role);
      builds.put(id, existing);
    }
    return existing;
  }

  void earned(int round) {
    for (var survivor : runner.game().participants()) {
      var build = build(survivor.id());
      var before = build.pending();
      build.cleared(round);
      if (build.pending() > before) {
        var player = runner.context().server().getPlayer(survivor.id());
        if (player != null) {
          Texts.info(
              player,
              "Class upgrade earned! Sneak-right-click your compass or /survival upgrades.");
          runner.feedback().play(player, SurvivalFeedback.Cue.UPGRADE);
        }
      }
    }
  }

  String status(Player player) {
    var id = player.getUniqueId();
    var build = build(id);
    var left =
        Math.max(
            0,
            java.time.Duration.between(
                    runner.context().time().instant(), cooldowns.getOrDefault(id, Instant.MIN))
                .toSeconds());
    return "Ability "
        + (left == 0 ? "READY · compass" : left + "s")
        + (build.pending() > 0 ? " · " + build.pending() + " class choices ready" : "");
  }

  void ability(Player player) {
    var id = player.getUniqueId();
    var now = runner.context().time().instant();
    if (!runner.isFighter(id) || now.isBefore(cooldowns.getOrDefault(id, Instant.MIN))) {
      Texts.error(player, "Your ability needs a standing survivor and a completed recharge.");
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      return;
    }
    var build = build(id);
    var resonant = now.isBefore(resonance.getOrDefault(id, Instant.MIN));
    if (!activate(player, resonant ? build.empowered() : build, now)) {
      Texts.error(player, "No valid target or room for this ability.");
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      return;
    }
    cooldowns.put(id, now.plusSeconds(build.cooldownSeconds()));
    resonance.remove(id);
    runner.relics().ability(player);
    if (build.role() == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass.MEDIC)
      runner.boons().healing(player);
    runner.feedback().play(player, SurvivalFeedback.Cue.ABILITY);
    Texts.info(player, "Ability used · " + build.cooldownSeconds() + " second recharge.");
  }

  private boolean activate(Player player, SurvivalBuild build, Instant now) {
    if (build.specialization().isEmpty()) return base(player, build);
    return switch (build.specialization().orElseThrow()) {
      case GUARDIAN -> {
        barrier(player, build.magnitude(8), build.utilitySeconds(8));
        yield true;
      }
      case VANGUARD -> {
        sweep(player, build.magnitude(8));
        yield true;
      }
      case MARKSMAN, PIERCER -> ranger(player, build, now);
      case FIELD_SURGEON -> {
        allies(player, 8).forEach(p -> SurvivalItems.heal(p, build.magnitude(8)));
        yield true;
      }
      case RESCUER -> rescue(player, build.magnitude(4));
      case FORTIFIER -> {
        repair(player, 8);
        allies(player, 6).forEach(p -> barrier(p, build.magnitude(4), build.utilitySeconds(8)));
        yield true;
      }
      case SAPPER -> {
        traps.put(
            player.getUniqueId(),
            new Trap(
                Places.at(player).clone(),
                build.magnitude(6),
                now.plusSeconds(build.utilitySeconds(15))));
        yield true;
      }
      case CRYOMANCER -> {
        enemies(player, 6)
            .forEach(e -> effect(e, PotionEffectType.SLOWNESS, build.utilitySeconds(6), 1));
        yield true;
      }
      case PLAGUE_BREWER -> {
        for (var enemy : enemies(player, 6)) {
          effect(enemy, PotionEffectType.WEAKNESS, build.utilitySeconds(6), 0);
          corrosion.put(
              enemy.getUniqueId(),
              new Corrosion(player.getUniqueId(), enemy, build.magnitude(6) / 6, 6, now));
        }
        yield true;
      }
      case PACKLEADER -> {
        companions(player, 2, build);
        yield true;
      }
      case WARDEN -> {
        companions(player, 1, build);
        barrier(player, build.magnitude(8), build.utilitySeconds(8));
        yield true;
      }
    };
  }

  private boolean base(Player player, SurvivalBuild build) {
    switch (build.role()) {
      case FIGHTER -> sweep(player, build.magnitude(4));
      case RANGER -> {
        if (!runner
            .items()
            .give(player, org.bukkit.Material.ARROW, (int) Math.ceil(build.magnitude(8))))
          return false;
        player.addPotionEffect(
            new PotionEffect(PotionEffectType.SPEED, build.utilitySeconds(5) * 20, 1));
      }
      case MEDIC -> allies(player, 8).forEach(p -> SurvivalItems.heal(p, build.magnitude(6)));
      case ENGINEER -> {
        return repair(player, (int) Math.ceil(build.magnitude(1)));
      }
      case ALCHEMIST ->
          enemies(player, 10)
              .forEach(
                  e -> {
                    effect(e, PotionEffectType.SLOWNESS, build.utilitySeconds(6), 1);
                    effect(e, PotionEffectType.WEAKNESS, build.utilitySeconds(6), 0);
                  });
      case BEASTMASTER -> companions(player, 1, build);
    }
    return true;
  }

  private boolean ranger(Player player, SurvivalBuild build, Instant now) {
    if (!runner.items().give(player, org.bukkit.Material.ARROW, 8)) return false;
    var type = build.specialization().orElseThrow();
    var factor = type == Specialization.MARKSMAN ? 1 + build.magnitude(.5) : build.magnitude(1);
    shots.put(
        player.getUniqueId(),
        new Shots(type, 3, factor, now.plusSeconds(build.utilitySeconds(12))));
    return true;
  }

  double shot(Player player, Projectile projectile) {
    var buff = shots.get(player.getUniqueId());
    if (buff == null || !runner.context().time().instant().isBefore(buff.until())) return 1;
    if (buff.type() == Specialization.PIERCER
        && projectile instanceof org.bukkit.entity.AbstractArrow arrow) arrow.setPierceLevel(2);
    if (buff.remaining() == 1) shots.remove(player.getUniqueId());
    else
      shots.put(
          player.getUniqueId(),
          new Shots(buff.type(), buff.remaining() - 1, buff.factor(), buff.until()));
    return buff.factor();
  }

  double companionDamage(UUID owner) {
    return 1.2 * companionFactors.getOrDefault(owner, 1.0);
  }

  private void companions(Player player, int count, SurvivalBuild build) {
    companions(player, count);
    companionFactors.put(player.getUniqueId(), build.magnitude(1));
  }

  void companions(Player player, int count) {
    companionFactors.remove(player.getUniqueId());
    runner.world().removeWolves(player.getUniqueId());
    var population = runner.world().alive() + runner.world().companions();
    if (population + count > runner.map().content().entityCap())
      count = Math.max(0, runner.map().content().entityCap() - population);
    runner.world().spawnWolves(player, count);
  }

  private boolean rescue(Player player, double health) {
    var target =
        runner.online().stream()
            .filter(p -> runner.downed(p.getUniqueId()))
            .filter(
                p ->
                    Places.at(p).distanceSquared(Places.at(player)) <= 25
                        && player.hasLineOfSight(p))
            .min(
                java.util.Comparator.comparingDouble(
                    p -> Places.at(p).distanceSquared(Places.at(player))));
    if (target.isEmpty()) return false;
    runner.revivePlayer(target.orElseThrow(), health);
    return true;
  }

  private List<Player> allies(Player player, int radius) {
    return runner.fighters().stream()
        .filter(
            p ->
                Places.at(p).distanceSquared(Places.at(player)) <= radius * radius
                    && player.hasLineOfSight(p))
        .toList();
  }

  private List<LivingEntity> enemies(Player player, int radius) {
    return runner.world().enemies().stream()
        .filter(
            e ->
                e.getLocation().distanceSquared(Places.at(player)) <= radius * radius
                    && player.hasLineOfSight(e))
        .limit(8)
        .toList();
  }

  private void sweep(Player player, double damage) {
    enemies(player, 5)
        .forEach(
            e -> {
              runner.combat().damage(e, player, damage);
              var push = e.getLocation().toVector().subtract(Places.at(player).toVector());
              if (push.lengthSquared() > .01) e.setVelocity(push.normalize().multiply(.8).setY(.3));
            });
  }

  private boolean repair(Player player, int limit) {
    var defenses =
        runner.map().open().stream()
            .flatMap(z -> z.defenses().stream())
            .filter(
                d ->
                    d.type()
                        == com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent
                            .DefenseType.BARRICADE)
            .filter(
                d ->
                    Places.location(player.getWorld(), d.block().center())
                            .distanceSquared(Places.at(player))
                        <= 64)
            .limit(limit)
            .toList();
    defenses.forEach(
        d -> {
          runner.map().state().repair(d.id());
          runner.map().barricade(d, org.bukkit.Material.OAK_FENCE);
        });
    return !defenses.isEmpty();
  }

  private void effect(LivingEntity enemy, PotionEffectType type, int seconds, int amplifier) {
    if (!runner.combat().bossEntity(enemy))
      enemy.addPotionEffect(new PotionEffect(type, seconds * 24, amplifier));
  }

  private void barrier(Player player, double amount, int seconds) {
    runner.wards().grant(player, SurvivalWards.Source.CLASS, amount, seconds);
  }

  void tick() {
    var now = runner.context().time().instant();
    for (var entry : List.copyOf(traps.entrySet())) tickTrap(entry.getKey(), entry.getValue(), now);
    for (var entry : List.copyOf(corrosion.entrySet()))
      tickCorrosion(entry.getKey(), entry.getValue(), now);
  }

  private void tickTrap(UUID id, Trap trap, Instant now) {
    if (!now.isBefore(trap.until())) {
      traps.remove(id);
      return;
    }
    runner.world().world().spawnParticle(Particle.ELECTRIC_SPARK, trap.at(), 3, .3, .1, .3, 0);
    if (runner.world().enemies().stream()
        .noneMatch(e -> e.getLocation().distanceSquared(trap.at()) <= 9)) return;
    traps.remove(id);
    var player = runner.context().server().getPlayer(id);
    if (player == null || !runner.isFighter(id)) return;
    runner.world().enemies().stream()
        .filter(e -> e.getLocation().distanceSquared(trap.at()) <= 25 && player.hasLineOfSight(e))
        .limit(8)
        .forEach(
            e -> {
              runner.combat().damage(e, player, trap.damage());
              if (!runner.combat().bossEntity(e))
                e.addPotionEffect(
                    new PotionEffect(
                        PotionEffectType.SLOWNESS, build(id).utilitySeconds(4) * 20, 1));
            });
  }

  private void tickCorrosion(UUID id, Corrosion dot, Instant now) {
    var owner = runner.context().server().getPlayer(dot.owner());
    if (owner == null
        || !runner.isFighter(dot.owner())
        || dot.target().isDead()
        || !dot.target().isValid()) {
      corrosion.remove(id);
      return;
    }
    if (now.isBefore(dot.next())) return;
    runner.combat().damage(dot.target(), owner, dot.damage());
    if (dot.remaining() == 1) corrosion.remove(id);
    else
      corrosion.put(
          id,
          new Corrosion(
              dot.owner(), dot.target(), dot.damage(), dot.remaining() - 1, now.plusSeconds(1)));
  }

  void interrupt(UUID id) {
    var player = runner.context().server().getPlayer(id);
    if (player != null) runner.wards().remove(player, SurvivalWards.Source.CLASS);
    shots.remove(id);
    traps.remove(id);
    corrosion.entrySet().removeIf(e -> e.getValue().owner().equals(id));
  }

  void leave(UUID id) {
    interrupt(id);
    builds.remove(id);
    cooldowns.remove(id);
    resonance.remove(id);
    companionFactors.remove(id);
  }
}
