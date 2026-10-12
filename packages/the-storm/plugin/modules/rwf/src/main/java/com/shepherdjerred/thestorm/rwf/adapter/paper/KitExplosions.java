// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/explosion/CustomExplosion.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExplosionDamage;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.Optional;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

/**
 * Kit explosions (landmines, RPGs, grenades): never a block broken, only combatants hurt. Each
 * living enemy of the owner within reach, and the owner themselves, takes Red Warfare's explosion
 * damage for their distance and how much of them the blast can see, through both kits' rules and
 * armor, and has its velocity set away from the blast. Allies are spared. Main thread only.
 */
final class KitExplosions {

  private final MatchRunner runner;
  private final PaperContext context;
  private final CombatTracker tracker;
  private final Sacrifices sacrifices;

  KitExplosions(MatchRunner runner, PaperContext context, CombatTracker tracker) {
    this.runner = runner;
    this.context = context;
    this.tracker = tracker;
    this.sacrifices = new Sacrifices(runner, context, tracker);
  }

  void explode(AbilityEffect.Explode blast) {
    explode(blast, true);
  }

  /**
   * A blast of no size, as a dead thrower's grenade made in Red Warfare: its sound and smoke, and
   * nobody hurt.
   */
  void bang(Location center) {
    var random = runner.match().random(runner.now());
    var first = random.nextFloat();
    var second = random.nextFloat();
    center
        .getWorld()
        .playSound(center, Sound.ENTITY_GENERIC_EXPLODE, 4, (1 + (first - second) * 0.2F) * 0.7F);
    center.getWorld().spawnParticle(Particle.EXPLOSION, center, 1);
  }

  /** {@code blast}, which spares its owner too unless {@code hurtsOwner}, as napalm's does. */
  void explode(AbilityEffect.Explode blast, boolean hurtsOwner) {
    var world = context.mapWorld();
    var center = Places.location(world, blast.at());
    var random = runner.match().random(runner.now());
    var first = random.nextFloat();
    var second = random.nextFloat();
    world.playSound(center, Sound.ENTITY_GENERIC_EXPLODE, 4, (1 + (first - second) * 0.2F) * 0.7F);
    world.spawnParticle(Particle.EXPLOSION, center, 1);
    var owner = runner.member(blast.owner());
    for (var member : runner.match().members()) {
      if (!member.alive()) {
        continue;
      }
      var self = member.id().equals(blast.owner());
      if (self && !hurtsOwner) {
        continue;
      }
      if (!self
          && owner.flatMap(Combatant::team).isPresent()
          && member.team().equals(owner.orElseThrow().team())) {
        continue;
      }
      runner.entity(member.id()).ifPresent(victim -> hit(blast, center, victim, self));
    }
  }

  /**
   * {@code blast} on the creatures {@code hits} picks, for napalm: Red Warfare's explosions hurt
   * every living thing near them, not only the fighters. Each takes the explosion's damage for its
   * distance and how much of it the blast sees, with no armour or kit, and is thrown away from the
   * centre.
   */
  void explodeOnCreatures(AbilityEffect.Explode blast, Predicate<LivingEntity> hits) {
    var world = context.mapWorld();
    var center = Places.location(world, blast.at());
    var reach = blast.power() * 2 + 1;
    for (var entity : world.getNearbyEntities(center, reach, reach, reach)) {
      if (!(entity instanceof LivingEntity creature)
          || creature instanceof Player
          || !hits.test(creature)) {
        continue;
      }
      var distance = Places.at(creature).distance(center);
      var exposure = exposure(center, creature);
      var raw = ExplosionDamage.of(distance, blast.power(), exposure, blast.maxDamage());
      if (raw.isEmpty()) {
        continue;
      }
      var away =
          Places.at(creature)
              .toVector()
              .add(new Vector(0, creature.getEyeHeight(), 0))
              .subtract(center.toVector());
      if (away.lengthSquared() > 0) {
        creature.setVelocity(away.normalize().multiply((1 - distance / blast.power()) * exposure));
      }
      Summons.flinch(creature, runner.match().random(runner.now()));
      creature.setHealth(Math.max(0, creature.getHealth() - raw.getAsDouble()));
    }
  }

  private void hit(AbilityEffect.Explode blast, Location center, Player victim, boolean self) {
    var feet = Places.at(victim);
    var distance = feet.distance(center);
    var exposure = exposure(center, victim);
    var raw = ExplosionDamage.of(distance, blast.power(), exposure, blast.maxDamage());
    if (raw.isEmpty()) {
      return;
    }
    var cause = self ? blast.selfCause() : blast.cause();
    var hit =
        DamageFormula.Hit.of(cause, raw.getAsDouble(), KitFactory.armor(victim))
            .plus(self ? blast.selfExtra() : 0);
    // A bonded ally is still thrown back, and its Sacrificial takes the blast, as Red Warfare's
    // Sacrificial took every damage event meant for an ally.
    var attacker = self ? Optional.<Player>empty() : runner.entity(blast.owner());
    if (sacrifices.guardian(victim, cause).isPresent()) {
      push(center, victim, (1 - distance / blast.power()) * exposure);
      sacrifices.shield(attacker, victim, hit);
      return;
    }
    var victimSide = runner.kits().side(victim.getUniqueId());
    if (victimSide.isEmpty()) {
      return;
    }
    Optional<KitCombat.Side> attackerSide =
        self
            ? Optional.empty()
            : runner
                .member(blast.owner())
                .flatMap(Combatant::kit)
                .map(
                    kit ->
                        new KitCombat.Side(kit, runner.match().abilities().state(blast.owner())));
    var damage =
        KitCombat.damage(
            hit, attackerSide, victimSide.orElseThrow(), runner.match().random(runner.now()));
    if (damage <= 0) {
      return;
    }
    var by = self ? Optional.<java.util.UUID>empty() : Optional.of(blast.owner().uuid());
    tracker.hit(victim, damage, by, cause);
    runner.damaged(victim, by, damage, cause);
    push(center, victim, (1 - distance / blast.power()) * exposure);
    victim.setHealth(Math.max(0, victim.getHealth() - damage));
    if (!self) {
      // The owner was the blast's damager, so their kit heard it as their own hit, with whatever
      // they held (a Venom's iron sword poisons a blast victim).
      var ownerEntity = runner.entity(blast.owner());
      if (ownerEntity.isPresent()) {
        runner.kits().hit(ownerEntity.orElseThrow(), victim, cause, damage);
      } else {
        runner.kits().hit(blast.owner(), victim, cause, damage);
      }
    }
  }

  /** Throws {@code victim} away from the blast, harder the nearer and more exposed they are. */
  private static void push(Location center, Player victim, double scale) {
    var push =
        Places.at(victim)
            .toVector()
            .add(new Vector(0, victim.getEyeHeight(), 0))
            .subtract(center.toVector());
    if (push.lengthSquared() > 0) {
      // Red Warfare's explosion knockback set the victim's velocity (UtilEnt.velocity).
      victim.setVelocity(push.normalize().multiply(scale));
    }
  }

  /**
   * The share of {@code victim}'s bounding box the blast at {@code center} can see, as vanilla's
   * explosions measure it: a grid of points through the box, each traced back to the centre.
   */
  private double exposure(Location center, LivingEntity victim) {
    var box = victim.getBoundingBox();
    var stepX = 1 / (box.getWidthX() * 2 + 1);
    var stepY = 1 / (box.getHeight() * 2 + 1);
    var stepZ = 1 / (box.getWidthZ() * 2 + 1);
    var seen = 0;
    var total = 0;
    for (var x = 0.0; x <= 1; x += stepX) {
      for (var y = 0.0; y <= 1; y += stepY) {
        for (var z = 0.0; z <= 1; z += stepZ) {
          var point =
              new Vector(
                  box.getMinX() + box.getWidthX() * x,
                  box.getMinY() + box.getHeight() * y,
                  box.getMinZ() + box.getWidthZ() * z);
          total++;
          if (clear(point, center.toVector())) {
            seen++;
          }
        }
      }
    }
    return total == 0 ? 0 : (double) seen / total;
  }

  /** Whether nothing solid stands between {@code from} and {@code to}, walked a quarter apart. */
  private boolean clear(Vector from, Vector to) {
    var step = to.clone().subtract(from);
    var length = step.length();
    if (length < 1.0e-6) {
      return true;
    }
    step.normalize().multiply(0.25);
    var at = from.clone();
    for (var walked = 0.0; walked < length; walked += 0.25) {
      if (context
          .mapWorld()
          .getBlockAt(at.getBlockX(), at.getBlockY(), at.getBlockZ())
          .getType()
          .isSolid()) {
        return false;
      }
      at.add(step);
    }
    return true;
  }
}
