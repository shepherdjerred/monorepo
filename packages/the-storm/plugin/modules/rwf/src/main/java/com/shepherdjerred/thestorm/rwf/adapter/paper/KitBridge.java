package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCombat;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/**
 * How the world reaches the match's kit abilities: a hit, a hurt or a kit item used becomes a
 * {@link MatchEvent.Ability}, and a hit's damage passes both fighters' abilities.
 */
final class KitBridge {

  private final MatchRunner runner;
  private final KitPowers powers;

  KitBridge(MatchRunner runner, KitPowers powers) {
    this.runner = runner;
    this.powers = powers;
  }

  /** {@code entity}'s kit and ability state, while they fight in a live match. */
  Optional<KitCombat.Side> side(UUID entity) {
    if (!runner.fighting(entity)) {
      return Optional.empty();
    }
    return runner
        .memberOf(entity)
        .flatMap(
            member ->
                member
                    .kit()
                    .map(
                        kit ->
                            new KitCombat.Side(
                                kit, runner.match().abilities().state(member.id()))));
  }

  /**
   * The damage {@code attacker}'s hit on {@code victim} deals: the combat rules' formula with both
   * kits' abilities applied, before the hit window.
   */
  double damage(AttackType type, Player attacker, Player victim, double raw) {
    if (type.has(AttackType.Flag.MELEE)) powers.expansion().meleeFacts(attacker, victim);
    var base = CombatListener.hit(type, attacker, victim, raw);
    var attackerSide = side(attacker.getUniqueId());
    var victimSide = side(victim.getUniqueId());
    if (victimSide.isEmpty()) {
      return DamageFormula.finalDamage(base);
    }
    return PaperKitResistance.apply(
        victim,
        KitCombat.damage(
            base, attackerSide, victimSide.orElseThrow(), runner.match().random(runner.now())),
        type);
  }

  /** {@code attacker}'s hit on {@code victim} landed {@code damage}: their kits hear of it. */
  void hit(Player attacker, Player victim, AttackType type, double damage) {
    hit(attacker, victim, type, new Landed(damage, victim.getHealth()));
  }

  record Landed(double damage, double healthAfter) {}

  private record Impact(AttackType type, Optional<String> weapon, Landed landed) {}

  /** A native event completes health mutation after listeners; abilities receive its result. */
  void hit(Player attacker, Player victim, AttackType type, Landed landed) {
    var attackerId = runner.memberOf(attacker.getUniqueId()).map(Combatant::id);
    if (attackerId.isEmpty()) {
      return;
    }
    var held = attacker.getInventory().getItemInMainHand();
    var weapon = held.isEmpty() ? Optional.<String>empty() : Optional.of(held.getType().name());
    struck(victim, new Impact(type, weapon, landed))
        .ifPresent(hit -> act(attackerId.orElseThrow(), hit));
  }

  /**
   * {@code attacker}'s explosion or summons hit {@code victim}: their kits hear of it, with what
   * the attacker holds now, as Red Warfare's abilities read the damager's hand whatever the hit.
   */
  void hit(CombatantId attacker, Player victim, AttackType type, double damage) {
    var weapon =
        runner
            .entity(attacker)
            .map(player -> player.getInventory().getItemInMainHand())
            .filter(held -> !held.isEmpty())
            .map(held -> held.getType().name());
    struck(victim, new Impact(type, weapon, new Landed(damage, victim.getHealth())))
        .ifPresent(hit -> act(attacker, hit));
  }

  /** The hit on {@code victim}, if they fight in a live match. */
  private Optional<AbilityInput.Hit> struck(Player victim, Impact impact) {
    var victimId = runner.memberOf(victim.getUniqueId()).map(Combatant::id);
    if (victimId.isEmpty() || !runner.live()) {
      return Optional.empty();
    }
    return Optional.of(
        new AbilityInput.Hit(
            victimId.orElseThrow(),
            impact.type(),
            impact.weapon(),
            impact.landed().damage(),
            impact.landed().healthAfter(),
            PlayerAttributes.maxHealth(victim)));
  }

  /** {@code victim} was hurt by the world: their kit hears of it. */
  void hurt(Player victim, AttackType type, double damage) {
    var victimId =
        runner.memberOf(victim.getUniqueId()).filter(Combatant::alive).map(Combatant::id);
    if (victimId.isEmpty() || !runner.live()) {
      return;
    }
    act(victimId.orElseThrow(), new AbilityInput.Hurt(Optional.empty(), type, damage));
  }

  /** {@code actor}'s kit acts; why not, if the match refused. */
  Optional<MatchError> act(CombatantId actor, AbilityInput input) {
    return runner.handle(new MatchEvent.Ability(actor, input, runner.now()));
  }

  /** {@code player}'s kit acts; why not, if the match refused. */
  Optional<MatchError> act(Player player, AbilityInput input) {
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    return act(member.orElseThrow().id(), input);
  }

  /** Whether {@code entity} is something a kit put in the world. */
  boolean isKitEntity(Entity entity) {
    return powers.isKitEntity(entity);
  }
}
