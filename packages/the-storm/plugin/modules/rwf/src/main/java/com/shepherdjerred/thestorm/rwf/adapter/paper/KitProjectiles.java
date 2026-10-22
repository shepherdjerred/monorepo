// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// ExplosiveAbility.java and WraithAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.random.RandomGenerator;
import org.bukkit.Color;
import org.bukkit.FireworkEffect;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.FireworkEffectMeta;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * What kits throw and shoot, from launch to detonation, as Red Warfare had them. An RPG is an arrow
 * shot with a thrown egg's velocity and dressed as an egg (Red Warfare disguised it; here an egg
 * display rides along and the arrow itself is hidden), trailing a cloud, and explodes where it
 * hits. A grenade is a team-coloured star thrown from the eye that explodes three seconds later,
 * smoking every fifth tick; a dead thrower's only bangs. A Wraith's arrows trail its team's colour.
 * A detonation goes back to the rules as the thrower's own action. Main thread only.
 */
final class KitProjectiles {

  /** Red Warfare's {@code EntityThrowable}: an egg leaves this far below the eye. */
  private static final double THROW_DROP = 0.1;

  /** A thrown egg's speed and spread, in 1.12's {@code EntityThrowable.shoot}. */
  private static final double EGG_SPEED = 1.5;

  private static final double EGG_SPREAD = 0.0075;

  /**
   * One grenade on the ground or in the air.
   *
   * @param owner who threw it
   * @param thrownAt when
   */
  private record Grenade(CombatantId owner, Instant thrownAt) {}

  /**
   * One RPG in flight.
   *
   * @param owner who fired it
   * @param arrow what flies
   * @param egg how it looks
   */
  private record Rpg(CombatantId owner, AbstractArrow arrow, java.util.Optional<ItemDisplay> egg) {}

  /**
   * One wraith arrow and its trail.
   *
   * @param last where the trail last reached
   * @param color the shooter's team colour
   */
  private record Trail(Location last, Color color) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final KitExplosions explosions;
  private final Map<UUID, Rpg> rpgs = new HashMap<>();
  private final Map<Item, Grenade> grenades = new HashMap<>();
  private final Map<AbstractArrow, Trail> trails = new HashMap<>();
  private long smokeTicks;

  KitProjectiles(MatchRunner runner, PaperContext context, Keys keys, KitExplosions explosions) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.explosions = explosions;
  }

  /** Launches {@code projectile} from {@code player}. */
  void launch(Player player, CombatantId owner, AbilityEffect.Projectile projectile) {
    switch (projectile) {
      case RPG -> rpg(player, owner);
      case GRENADE -> grenade(player, owner);
    }
  }

  /**
   * Red Warfare let the egg be thrown, then swapped it for an arrow at the egg's place and speed,
   * and threw the firer back, half as hard while sneaking, lifted off the ground.
   */
  private void rpg(Player player, CombatantId owner) {
    var from = player.getEyeLocation().subtract(0, THROW_DROP, 0);
    var velocity = eggVelocity(player, context.random());
    // Launched from the player, an arrow leaves where the egg did: a tenth below the eye.
    var arrow =
        player.launchProjectile(
            Arrow.class,
            velocity,
            shot -> {
              shot.setPickupStatus(AbstractArrow.PickupStatus.DISALLOWED);
              shot.setPersistent(false);
              keys.tagKitEntity(shot);
            });
    // The egg rides in its place; the arrow itself is not to be seen.
    context.guarded("hide the arrow of an rpg", () -> arrow.setVisibleByDefault(false));
    rpgs.put(arrow.getUniqueId(), new Rpg(owner, arrow, egg(from)));
    var back =
        Places.at(player).getDirection().normalize().multiply(player.isSneaking() ? -0.4 : -0.8);
    if (((Entity) player).isOnGround() && back.getY() <= 0.01) {
      back.setY(0.2);
    }
    player.setVelocity(KnockbackShare.landing(runner, player, back));
  }

  /** The egg an RPG looks like; dressing, so one that cannot be shown does not stop the shot. */
  private java.util.Optional<ItemDisplay> egg(Location from) {
    var egg = new java.util.concurrent.atomic.AtomicReference<@Nullable ItemDisplay>();
    context.guarded(
        "dress an rpg as an egg",
        () ->
            egg.set(
                context
                    .mapWorld()
                    .spawn(
                        from,
                        ItemDisplay.class,
                        display -> {
                          display.setItemStack(ItemStack.of(Material.EGG));
                          display.setItemDisplayTransform(ItemDisplay.ItemDisplayTransform.GROUND);
                          display.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
                          display.setTeleportDuration(1);
                          display.setPersistent(false);
                          keys.tagKitEntity(display);
                        })));
    return java.util.Optional.ofNullable(egg.get());
  }

  /**
   * A thrown egg's velocity, as 1.12 threw it: 1.5 along the look, a little spread, plus the run.
   */
  static Vector eggVelocity(Player player, RandomGenerator random) {
    var at = Places.at(player);
    var yaw = Math.toRadians(at.getYaw());
    var pitch = Math.toRadians(at.getPitch());
    var direction =
        new Vector(
            -Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    direction.normalize();
    direction.add(
        new Vector(
            random.nextGaussian() * EGG_SPREAD,
            random.nextGaussian() * EGG_SPREAD,
            random.nextGaussian() * EGG_SPREAD));
    direction.multiply(EGG_SPEED);
    var run = player.getVelocity();
    direction.add(
        new Vector(run.getX(), ((Entity) player).isOnGround() ? 0 : run.getY(), run.getZ()));
    return direction;
  }

  private void grenade(Player player, CombatantId owner) {
    var stack = ItemStack.of(Material.FIREWORK_STAR);
    runner
        .member(owner)
        .flatMap(Combatant::team)
        .ifPresent(
            team ->
                stack.editMeta(
                    FireworkEffectMeta.class,
                    meta ->
                        meta.setEffect(
                            FireworkEffect.builder().withColor(Classic.dye(team)).build())));
    var at = player.getEyeLocation().subtract(0, 0.2, 0);
    var look = Places.at(player).getDirection().normalize();
    var item =
        context
            .mapWorld()
            .dropItem(
                at,
                stack,
                dropped -> {
                  keys.tagKitEntity(dropped);
                  dropped.setPickupDelay(Integer.MAX_VALUE);
                  dropped.setCanMobPickup(false);
                  dropped.setVelocity(look.clone().multiply(0.8));
                });
    grenades.put(item, new Grenade(owner, runner.now()));
  }

  /** Whether {@code entity} is an RPG still tracked in flight. Other kit entities are not RPGs. */
  boolean isRpg(Entity entity) {
    return rpgs.containsKey(entity.getUniqueId());
  }

  /**
   * {@code entity} was a kit projectile that hit something: an RPG explodes a tenth of a block back
   * along the way the arrow faces, which for an arrow's own yaw and pitch is not quite back.
   */
  boolean hit(Entity entity) {
    var rpg = rpgs.remove(entity.getUniqueId());
    if (rpg == null) {
      return false;
    }
    rpg.egg().ifPresent(Entity::remove);
    var at = Places.at(entity);
    at.subtract(at.getDirection().normalize().multiply(0.1));
    entity.remove();
    runner
        .kits()
        .act(rpg.owner(), new AbilityInput.Detonate(AbilityEffect.Projectile.RPG, Places.vec(at)));
    return true;
  }

  /** {@code arrow} was loosed by a Wraith of {@code color}: it trails that colour. */
  void trail(AbstractArrow arrow, Color color) {
    trails.put(arrow, new Trail(arrow.getLocation(), color));
  }

  void tick(Instant now) {
    smokeTicks++;
    flyGrenades(now);
    flyRpgs();
    // The trails are dressing: one that cannot be drawn must not stop the match's clock.
    context.guarded("draw the wraith trails", this::trails);
  }

  private void flyGrenades(Instant now) {
    for (var entry : Map.copyOf(grenades).entrySet()) {
      var item = entry.getKey();
      var grenade = entry.getValue();
      if (!item.isValid()) {
        grenades.remove(item);
        continue;
      }
      if (!now.isAfter(grenade.thrownAt().plus(Explosive.FUSE))) {
        if (smokeTicks % 5 == 0) {
          Classic.particle(
              Classic.Puff.of(Particle.SMOKE, 1),
              item.getLocation().add(0, 0.5, 0),
              Classic.NORMAL,
              context.server().getOnlinePlayers());
        }
        continue;
      }
      grenades.remove(item);
      var at = item.getLocation().add(0, 0.2, 0);
      item.remove();
      if (runner.member(grenade.owner()).filter(Combatant::alive).isPresent()) {
        runner
            .kits()
            .act(
                grenade.owner(),
                new AbilityInput.Detonate(AbilityEffect.Projectile.GRENADE, Places.vec(at)));
      } else {
        explosions.bang(at);
      }
    }
  }

  private void flyRpgs() {
    for (var entry : Map.copyOf(rpgs).entrySet()) {
      var shot = entry.getValue().arrow();
      if (!shot.isValid()) {
        rpgs.remove(entry.getKey());
        entry.getValue().egg().ifPresent(Entity::remove);
      } else {
        entry.getValue().egg().ifPresent(egg -> egg.teleport(shot.getLocation()));
        Classic.particle(
            Classic.Puff.of(Particle.POOF, 1),
            shot.getLocation(),
            Classic.LONG,
            context.server().getOnlinePlayers());
      }
    }
  }

  private void trails() {
    for (var entry : Map.copyOf(trails).entrySet()) {
      var arrow = entry.getKey();
      if (!arrow.isValid() || arrow.isInBlock()) {
        trails.remove(arrow);
        continue;
      }
      var trail = entry.getValue();
      var dust = new Particle.DustOptions(trail.color(), 1);
      for (var point : KitDisplays.line(trail.last(), arrow.getLocation(), 0.4)) {
        Classic.particle(
            Classic.Puff.of(Particle.DUST, 1).with(dust),
            point,
            Classic.NORMAL,
            context.server().getOnlinePlayers());
      }
      trails.put(arrow, new Trail(arrow.getLocation(), trail.color()));
    }
  }

  /** The match reset: every projectile and grenade goes. */
  void clear() {
    grenades.keySet().forEach(Item::remove);
    grenades.clear();
    for (var rpg : rpgs.values()) {
      rpg.arrow().remove();
      rpg.egg().ifPresent(Entity::remove);
    }
    rpgs.clear();
    trails.clear();
  }

  /** The RPGs in flight, for tests. */
  java.util.List<AbstractArrow> rpgsInFlight() {
    return rpgs.values().stream().map(Rpg::arrow).toList();
  }
}
