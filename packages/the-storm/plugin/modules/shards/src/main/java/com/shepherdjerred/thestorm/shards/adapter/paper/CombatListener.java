package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.Attack;
import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.Opponent;
import com.shepherdjerred.thestorm.shards.domain.StormPiece;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Firework;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Applies Storm bonuses to damage.
 *
 * <p>Bonuses are applied here, as a multiplier on the event's damage, rather than as attribute
 * modifiers on the item. An attribute modifier (attack damage, armor) knows nothing about who is on
 * the other side, so it cannot give the full bonus against mobs and a capped share against players;
 * it would also show up as a raw number in the tooltip and stack with vanilla armor's non-linear
 * formula. The event sees the attacker, the victim and vanilla's already-charged damage, so the
 * attack cooldown, crits, the mace's smash and enchantments all scale naturally.
 *
 * <p>The handlers only read the event and write the damage; the decisions live in {@link
 * #dealtMultiplier} and {@link #takenMultiplier}.
 */
final class CombatListener implements Listener {

  private static final Set<DamageCause> SWINGS =
      Set.of(DamageCause.ENTITY_ATTACK, DamageCause.ENTITY_SWEEP_ATTACK);

  private final Bonuses bonuses;
  private final StormGear gear;

  CombatListener(Bonuses bonuses, StormGear gear) {
    this.bonuses = bonuses;
    this.gear = gear;
  }

  @EventHandler(ignoreCancelled = true)
  void onShoot(EntityShootBowEvent event) {
    tagRocket(event.getProjectile(), event.getBow());
  }

  /**
   * A firework rocket does not remember the crossbow that fired it (arrows do), so the crossbow's
   * tier is copied onto the rocket when it is shot.
   */
  void tagRocket(Entity projectile, @Nullable ItemStack launcher) {
    if (projectile instanceof Firework rocket) {
      gear.pieceOf(launcher).ifPresent(piece -> gear.tagProjectile(rocket, piece));
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onHit(EntityDamageByEntityEvent event) {
    var source = event.getDamageSource();
    var multiplier =
        dealtMultiplier(
            source.getCausingEntity(),
            source.getDirectEntity(),
            event.getCause(),
            event.getEntity());
    if (multiplier != 1) {
      event.setDamage(event.getDamage() * multiplier);
    }
  }

  /**
   * The factor on damage a player deals with Storm weapons: a swing (main hand, attack or sweep),
   * or an arrow, thrown trident or crossbow rocket carrying the weapon that launched it. Thorns, a
   * bow swung in melee, self-harm and every other cause get exactly 1.
   */
  double dealtMultiplier(
      @Nullable Entity causing, @Nullable Entity direct, DamageCause cause, Entity victim) {
    if (!(causing instanceof Player attacker)
        || !(victim instanceof LivingEntity)
        || victim.equals(attacker)) {
      return 1;
    }
    var opponent = victim instanceof Player ? Opponent.PLAYER : Opponent.MOB;
    Optional<StormPiece> weapon;
    Attack attack;
    if (attacker.equals(direct) && SWINGS.contains(cause)) {
      weapon = gear.pieceOf(attacker.getInventory().getItemInMainHand());
      attack = Attack.MELEE;
    } else if (direct instanceof AbstractArrow projectile) {
      // The arrow (or trident) carries a copy of the bow, crossbow or trident that launched it.
      weapon = gear.pieceOf(projectile.getWeapon());
      attack = Attack.PROJECTILE;
    } else if (direct instanceof Firework rocket) {
      weapon = gear.projectilePiece(rocket);
      attack = Attack.PROJECTILE;
    } else {
      return 1;
    }
    return weapon.map(piece -> bonuses.damageDealtMultiplier(piece, attack, opponent)).orElse(1.0);
  }

  @EventHandler(ignoreCancelled = true)
  void onHurt(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player victim) {
      var multiplier = takenMultiplier(victim, event.getDamageSource().getCausingEntity());
      if (multiplier != 1) {
        event.setDamage(event.getDamage() * multiplier);
      }
    }
  }

  /**
   * The factor on damage {@code victim} takes from {@code cause} through Storm armor: summed over
   * the worn pieces and capped, scaled for PvP, and exactly 1 with no attacker (falls, fire, the
   * void) or self-inflicted damage.
   */
  double takenMultiplier(Player victim, @Nullable Entity cause) {
    var opponent = opponentOf(cause, victim);
    if (opponent == Opponent.ENVIRONMENT) {
      return 1;
    }
    var inventory = victim.getInventory();
    var worn = new ArrayList<StormPiece>();
    for (var armor :
        List.of(
            Optional.ofNullable(inventory.getHelmet()),
            Optional.ofNullable(inventory.getChestplate()),
            Optional.ofNullable(inventory.getLeggings()),
            Optional.ofNullable(inventory.getBoots()))) {
      armor.flatMap(gear::pieceOf).filter(piece -> piece.category().isArmor()).ifPresent(worn::add);
    }
    return bonuses.damageTakenMultiplier(List.copyOf(worn), opponent);
  }

  private static Opponent opponentOf(@Nullable Entity cause, Player victim) {
    if (cause instanceof Player attacker) {
      return attacker.equals(victim) ? Opponent.ENVIRONMENT : Opponent.PLAYER;
    }
    return cause instanceof LivingEntity ? Opponent.MOB : Opponent.ENVIRONMENT;
  }
}
