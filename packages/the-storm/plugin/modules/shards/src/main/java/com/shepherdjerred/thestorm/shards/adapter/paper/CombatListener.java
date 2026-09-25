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
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
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

  /** Storm weapons: more damage dealt by a player's swing, arrow or thrown trident. */
  @EventHandler(ignoreCancelled = true)
  void onHit(EntityDamageByEntityEvent event) {
    var source = event.getDamageSource();
    if (!(source.getCausingEntity() instanceof Player attacker)
        || !(event.getEntity() instanceof LivingEntity victim)
        || victim.equals(attacker)) {
      return;
    }
    var opponent = victim instanceof Player ? Opponent.PLAYER : Opponent.MOB;
    var direct = source.getDirectEntity();
    if (attacker.equals(direct) && SWINGS.contains(event.getCause())) {
      apply(
          event, gear.pieceOf(attacker.getInventory().getItemInMainHand()), Attack.MELEE, opponent);
    } else if (direct instanceof AbstractArrow projectile) {
      // The arrow (or trident) carries a copy of the bow, crossbow or trident that launched it.
      apply(event, gear.pieceOf(projectile.getWeapon()), Attack.PROJECTILE, opponent);
    }
  }

  private void apply(
      EntityDamageEvent event, Optional<StormPiece> weapon, Attack attack, Opponent opponent) {
    weapon.ifPresent(
        piece ->
            event.setDamage(
                event.getDamage() * bonuses.damageDealtMultiplier(piece, attack, opponent)));
  }

  /** Storm armor: less damage taken by a player from any attacker, summed and capped. */
  @EventHandler(ignoreCancelled = true)
  void onHurt(EntityDamageEvent event) {
    if (!(event.getEntity() instanceof Player victim)) {
      return;
    }
    var opponent = opponentOf(event.getDamageSource().getCausingEntity(), victim);
    if (opponent == Opponent.ENVIRONMENT) {
      return;
    }
    var worn = new ArrayList<StormPiece>();
    var inventory = victim.getInventory();
    for (var armor :
        List.of(
            Optional.ofNullable(inventory.getHelmet()),
            Optional.ofNullable(inventory.getChestplate()),
            Optional.ofNullable(inventory.getLeggings()),
            Optional.ofNullable(inventory.getBoots()))) {
      armor.flatMap(gear::pieceOf).filter(piece -> piece.category().isArmor()).ifPresent(worn::add);
    }
    if (!worn.isEmpty()) {
      event.setDamage(
          event.getDamage() * bonuses.damageTakenMultiplier(List.copyOf(worn), opponent));
    }
  }

  private static Opponent opponentOf(@Nullable Entity cause, Player victim) {
    if (cause instanceof Player attacker) {
      return attacker.equals(victim) ? Opponent.ENVIRONMENT : Opponent.PLAYER;
    }
    return cause instanceof LivingEntity ? Opponent.MOB : Opponent.ENVIRONMENT;
  }
}
