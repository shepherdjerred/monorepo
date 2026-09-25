package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.Land;

/**
 * Decides whether a player may do something on a piece of land.
 *
 * <ul>
 *   <li>Wilderness: anything.
 *   <li>A town's claim: the owner and trusted members anything; outsiders what the claim's public
 *       flags open (see {@link OutsiderAccess}).
 *   <li>An admin region: only what the region allows.
 *   <li>Staff with bypass: anything, except that bypass never turns PvP on.
 * </ul>
 */
public final class ProtectionEngine {

  private final TownLandRule towns;

  public ProtectionEngine(TrustLookup trust) {
    this.towns = new TownLandRule(trust);
  }

  public Verdict decide(Actor actor, Act act, Land land) {
    if (actor.bypass() && act.action() != Action.ATTACK_PLAYER) {
      return Verdict.allow();
    }
    return switch (land) {
      case Land.Wilderness _ -> Verdict.allow();
      case Land.TownLand(var claim) -> towns.decide(actor, act, claim);
      case Land.RegionLand(var region) -> RegionLandRule.decide(act, region);
    };
  }

  /**
   * Whether {@code attacker} may hurt another player: PvP must be on both where the attacker stands
   * and where the victim stands, so nobody fights out of or into a safe zone.
   */
  public Verdict decidePvp(Actor attacker, Land attackerLand, Land victimLand) {
    var fight = new Act(Action.ATTACK_PLAYER, Subject.PLAYER);
    return decide(attacker, fight, attackerLand).and(decide(attacker, fight, victimLand));
  }

  /**
   * Whether {@code attacker} may hurt, push or pull {@code victim}, which stands on {@code
   * victimLand}:
   *
   * <ul>
   *   <li>themselves, their own pets and unprotected entities: always;
   *   <li>another player: where PvP is on for both;
   *   <li>another player's pet: where PvP is on for both, and the pet's land lets the attacker hurt
   *       animals;
   *   <li>anything else: where the land lets the attacker hurt entities.
   * </ul>
   */
  public Verdict decideHarm(Actor attacker, Land attackerLand, Victim victim, Land victimLand) {
    return switch (victim) {
      case Victim.Self _, Victim.OwnPet _, Victim.Unprotected _ -> Verdict.allow();
      case Victim.OtherPlayer _ -> decidePvp(attacker, attackerLand, victimLand);
      case Victim.OthersPet _ ->
          decidePvp(attacker, attackerLand, victimLand)
              .and(decide(attacker, new Act(Action.DAMAGE_ENTITY, Subject.ANIMAL), victimLand));
      case Victim.Protected(var subject) ->
          decide(attacker, new Act(Action.DAMAGE_ENTITY, subject), victimLand);
    };
  }
}
