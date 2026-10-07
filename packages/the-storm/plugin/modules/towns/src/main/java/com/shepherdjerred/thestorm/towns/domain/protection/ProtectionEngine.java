package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.UUID;

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
 *
 * <p>Fighting another player also needs both players' own PvP switches on ({@link PvpPreferences}).
 */
public final class ProtectionEngine {

  private static final Act FIGHT = new Act(Action.ATTACK_PLAYER, Subject.PLAYER);

  private final TownLandRule towns;
  private final PvpPreferences pvp;

  public ProtectionEngine(TrustLookup trust, PvpPreferences pvp) {
    this.towns = new TownLandRule(trust);
    this.pvp = pvp;
  }

  public Verdict decide(Actor actor, Act act, Land land) {
    if (land instanceof Land.HeritageLand heritage)
      return HeritageRule.decide(actor, act, heritage);
    if (land instanceof Land.WorkLand(var region)) {
      return new Verdict.Deny(new Denial.ByRegion(region.name(), act.action()));
    }
    if (land instanceof Land.ParcelLand(var parcel)
        && parcel.phase()
            == com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase.RESETTING) {
      return new Verdict.Deny(new Denial.ByRegion(parcel.definition().name(), act.action()));
    }
    if (actor.bypass() && act.action() != Action.ATTACK_PLAYER) {
      return Verdict.allow();
    }
    return switch (land) {
      case Land.HeritageLand heritage -> HeritageRule.decide(actor, act, heritage);
      case Land.Wilderness _ -> Verdict.allow();
      case Land.TownLand(var claim) -> towns.decide(actor, act, claim);
      case Land.RegionLand(var region) -> RegionLandRule.decide(act, region);
      case Land.WorkLand(var region) -> RegionLandRule.decide(act, region);
      case Land.ParcelLand(var parcel) ->
          parcel.permits(actor.player(), act)
              ? Verdict.allow()
              : new Verdict.Deny(
                  act.action() == Action.ATTACK_PLAYER
                      ? new Denial.NoPvp()
                      : new Denial.ByRegion(parcel.definition().name(), act.action()));
    };
  }

  /**
   * Whether {@code attacker} may hurt the player {@code victim}: both must have their own PvP on,
   * and PvP must be on both where the attacker stands and where the victim stands, so nobody fights
   * out of or into a safe zone. Bypass changes none of this.
   */
  public Verdict decidePvp(Actor attacker, UUID victim, Land attackerLand, Land victimLand) {
    var theirs = pvp.pvpOn(victim) ? Verdict.allow() : new Verdict.Deny(new Denial.TheirPvpIsOff());
    return decideAttack(attacker, attackerLand, victimLand).and(theirs);
  }

  /**
   * The attacker's half of {@link #decidePvp}: their own PvP switch and the land at both ends, for
   * when the victim is not known.
   */
  public Verdict decideAttack(Actor attacker, Land attackerLand, Land victimLand) {
    var own =
        pvp.pvpOn(attacker.player())
            ? Verdict.allow()
            : new Verdict.Deny(new Denial.YourPvpIsOff());
    return own.and(decide(attacker, FIGHT, attackerLand)).and(decide(attacker, FIGHT, victimLand));
  }

  /**
   * Whether harm nobody can be blamed for (TNT without a lighter, a dispenser's arrows or potions,
   * a creeper's blast) may reach a player on {@code victimLand} when it started on {@code origin}.
   * Harm from the victim's own land's owner is theirs to allow; harm from anywhere else, the
   * wilderness included, reaches the player only where PvP is on, so a safe zone stays safe from a
   * cannon outside it.
   */
  public boolean allowsUntracedHarm(Land origin, Land victimLand) {
    if (victimLand.preventsPlayerDamage()) {
      return false;
    }
    if (origin.sameOwnerAs(victimLand)) {
      return true;
    }
    return pvpOn(victimLand);
  }

  private static boolean pvpOn(Land land) {
    return switch (land) {
      case Land.HeritageLand(var site, _, _) ->
          site.profile() == com.shepherdjerred.thestorm.towns.domain.region.RegionProfile.ARENA;
      case Land.Wilderness _ -> true;
      case Land.TownLand(var claim) -> claim.flags().has(ClaimFlag.PVP);
      case Land.RegionLand(var region) -> region.permits(FIGHT);
      case Land.ParcelLand _ -> false;
      case Land.WorkLand _ -> false;
    };
  }

  /**
   * Whether {@code attacker} may hurt, push or pull {@code victim}, which stands on {@code
   * victimLand}:
   *
   * <ul>
   *   <li>themselves, their own pets and unprotected entities: always;
   *   <li>another player: where PvP is on for both, and both have their own PvP on;
   *   <li>another player's pet: never, anywhere, bypass included;
   *   <li>anything else: where the land lets the attacker hurt entities.
   * </ul>
   */
  public Verdict decideHarm(Actor attacker, Land attackerLand, Victim victim, Land victimLand) {
    return switch (victim) {
      case Victim.Self _, Victim.OwnPet _, Victim.Unprotected _ -> Verdict.allow();
      case Victim.OtherPlayer(var id) -> decidePvp(attacker, id, attackerLand, victimLand);
      case Victim.OthersPet _ -> new Verdict.Deny(new Denial.NotYourPet());
      case Victim.Protected(var subject) ->
          decide(attacker, new Act(Action.DAMAGE_ENTITY, subject), victimLand);
    };
  }
}
