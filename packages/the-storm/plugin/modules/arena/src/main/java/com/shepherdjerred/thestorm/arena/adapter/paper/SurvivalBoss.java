package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.BossMechanics;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.Component;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/** Survival bosses have phases, visible casts, interrupts, safe lanes and recovery windows. */
final class SurvivalBoss {
  private final String id;
  private final LivingEntity entity;
  private final ArenaWorld world;
  private final BossMechanics mechanics;
  private final BlockPos objective;
  private final BossBar bar;
  private final Set<UUID> viewers = new HashSet<>();
  private Instant vulnerableUntil = Instant.MIN;
  private int heartHits;
  private boolean charged;
  private boolean striking;
  private final java.util.function.IntConsumer adds;
  private final int round;
  private final Set<Integer> phases = new HashSet<>();

  record Spawn(String id, LivingEntity entity, BlockPos objective, int round) {}

  SurvivalBoss(Spawn spawn, ArenaWorld world, Instant now, java.util.function.IntConsumer adds) {
    this.id = spawn.id();
    this.entity = spawn.entity();
    this.world = world;
    this.objective = spawn.objective();
    this.adds = adds;
    this.round = spawn.round();
    mechanics = new BossMechanics(id, now);
    entity.customName(Component.text(name()));
    entity.setCustomNameVisible(true);
    bar =
        BossBar.bossBar(Component.text(name()), 1, BossBar.Color.PURPLE, BossBar.Overlay.PROGRESS);
  }

  LivingEntity entity() {
    return entity;
  }

  boolean alive() {
    return entity.isValid() && !entity.isDead();
  }

  boolean protectedNow(Instant now) {
    return id.equals("heartwood") && !now.isBefore(vulnerableUntil);
  }

  double damageMultiplier(Instant now) {
    return now.isBefore(vulnerableUntil) ? 1.5 : 1;
  }

  boolean charged() {
    return charged;
  }

  boolean striking() {
    return striking;
  }

  java.util.Optional<BossMechanics.Cast> cast() {
    return mechanics.cast();
  }

  String name() {
    return switch (id) {
      case "gale-sovereign" -> "Breeze Sovereign";
      case "hexmaster" -> "Evoker Commander";
      case "ravager" -> "Ravager Siege Beast";
      case "heartwood" -> "Creaking Guardian";
      case "warden" -> "The Listening Warden";
      default -> throw new IllegalStateException("Unchecked boss " + id);
    };
  }

  void tick(Instant now, Collection<Player> fighters, Collection<Player> audience) {
    charged = false;
    var max = entity.getAttribute(Attribute.MAX_HEALTH);
    if (max == null) {
      throw new IllegalStateException("Boss has no health attribute");
    }
    var fraction = alive() ? entity.getHealth() / max.getValue() : 0;
    bar.progress((float) Math.clamp(fraction, 0, 1));
    var immunity = id.equals("gale-sovereign") ? " · Deflects ranged shots; use melee" : "";
    var recovery = now.isBefore(vulnerableUntil) ? " · Recovery window" : "";
    bar.name(Component.text(name() + immunity + recovery));
    audience.forEach(this::show);
    if (!alive() || fighters.isEmpty()) {
      return;
    }
    var target =
        fighters.stream()
            .min(
                java.util.Comparator.comparingDouble(
                    p -> Places.at(p).distanceSquared(entity.getLocation())))
            .orElseThrow();
    var phase = mechanics.phase(fraction);
    if (phases.add(phase)) adds.accept(phase);
    if (mechanics.begin(
        now, Places.point(entity.getLocation()), Places.point(Places.at(target)), fraction)) {
      audience.forEach(
          player -> {
            Texts.info(
                player,
                name()
                    + " casts "
                    + mechanics.cast().orElseThrow().shape()
                    + " — leave the marked ground! Phase "
                    + mechanics.phase(fraction));
            player.playSound(entity.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL, 1, 0.6f);
          });
    }
    mechanics.cast().ifPresent(this::telegraph);
    mechanics.impact(now).ifPresent(cast -> impact(cast, fighters, now));
    if (id.equals("heartwood") || (id.equals("hexmaster") && mechanics.cast().isPresent())) {
      world
          .world()
          .spawnParticle(
              Particle.END_ROD,
              Places.location(world.world(), objective.center()),
              20,
              0.5,
              1,
              0.5,
              0);
    }
  }

  private void show(Player player) {
    if (!viewers.add(player.getUniqueId())) return;
    player.showBossBar(bar);
    if (id.equals("gale-sovereign"))
      Texts.info(
          player,
          "Breeze Sovereign deflects arrows and tridents. Dodge the wind lanes, then attack in melee during recovery.");
  }

  private void telegraph(BossMechanics.Cast cast) {
    for (var x = -24; x <= 24; x += 2) {
      for (var z = -24; z <= 24; z += 2) {
        var point =
            new com.shepherdjerred.thestorm.arena.domain.geometry.Point(
                cast.origin().x() + x, cast.aim().y(), cast.origin().z() + z);
        var surface = surface(point);
        if (surface.isPresent() && cast.hits(Places.point(surface.orElseThrow()))) {
          world
              .world()
              .spawnParticle(Particle.FLAME, surface.orElseThrow().add(0, 0.1, 0), 1, 0, 0, 0, 0);
        }
      }
    }
  }

  private java.util.Optional<org.bukkit.Location> surface(
      com.shepherdjerred.thestorm.arena.domain.geometry.Point point) {
    var at = Places.location(world.world(), point);
    for (var offset = 2; offset >= -2; offset--) {
      var floor =
          world.world().getBlockAt(at.getBlockX(), at.getBlockY() + offset - 1, at.getBlockZ());
      var feet = floor.getRelative(org.bukkit.block.BlockFace.UP);
      if (floor.isCollidable()
          && feet.isPassable()
          && feet.getRelative(org.bukkit.block.BlockFace.UP).isPassable())
        return java.util.Optional.of(feet.getLocation().add(.5, 0, .5));
    }
    return java.util.Optional.empty();
  }

  private void impact(BossMechanics.Cast cast, Collection<Player> fighters, Instant now) {
    for (var player : fighters) {
      strike(cast, player);
    }
    if (cast.shape() == BossMechanics.Shape.CHARGE) {
      var location = Places.location(world.world(), cast.aim());
      if (world.contains(location) && location.getBlock().isPassable()) {
        entity.teleport(location);
      }
      vulnerableUntil = now.plusSeconds(5);
      charged = true;
      entity.setVelocity(new Vector());
    }
    vulnerableUntil = now.plusSeconds(cast.shape() == BossMechanics.Shape.CHARGE ? 5 : 4);
  }

  private void strike(BossMechanics.Cast cast, Player player) {
    if (!cast.hits(Places.point(Places.at(player))) || !entity.hasLineOfSight(player)) {
      return;
    }
    striking = true;
    try {
      player.damage(
          round == 5 ? 3 + cast.phase() : Math.min(10, 4 + cast.phase() + round / 15), entity);
    } finally {
      striking = false;
    }
    if (cast.shape() == BossMechanics.Shape.WIND_LANES) {
      var push = Places.at(player).toVector().subtract(entity.getLocation().toVector());
      if (push.lengthSquared() > 0.01) {
        player.setVelocity(push.normalize().multiply(1.2).setY(0.5));
      }
    }
  }

  boolean objective(Player player, BlockPos block, Instant now, Runnable credit) {
    if (!objective.equals(block)
        || Places.at(player).distanceSquared(Places.location(world.world(), block.center())) > 25) {
      return false;
    }
    if (id.equals("hexmaster")) {
      if (mechanics.interrupt(now)) {
        credit.run();
        vulnerableUntil = now.plusSeconds(8);
        Texts.info(player, "Ritual interrupted. The commander is exposed!");
      } else {
        Texts.info(player, "Interrupt the glowing ritual node while the commander is casting.");
      }
      return true;
    }
    if (id.equals("heartwood")) {
      credit.run();
      heartHits++;
      if (heartHits >= 3) {
        heartHits = 0;
        vulnerableUntil = now.plusSeconds(8);
        entity.setHealth(
            Math.max(
                0,
                entity.getHealth()
                    - java.util.Objects.requireNonNull(entity.getAttribute(Attribute.MAX_HEALTH))
                            .getValue()
                        * 0.2));
        Texts.info(player, "Heart broken. The guardian is exposed for eight seconds!");
      }
      return true;
    }
    return false;
  }

  void end() {
    viewers.forEach(
        id -> {
          var player = entity.getServer().getPlayer(id);
          if (player != null) {
            player.hideBossBar(bar);
          }
        });
    viewers.clear();
  }
}
