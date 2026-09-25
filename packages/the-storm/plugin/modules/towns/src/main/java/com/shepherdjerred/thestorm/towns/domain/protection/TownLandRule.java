package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;

/**
 * A town's claim: its owner and trusted members may do anything; outsiders only what the claim's
 * public flags open. PvP follows the claim's PVP flag for everyone, members included.
 */
final class TownLandRule {

  private final TrustLookup trust;

  TownLandRule(TrustLookup trust) {
    this.trust = trust;
  }

  Verdict decide(Actor actor, Act act, Claim claim) {
    if (act.action() == Action.ATTACK_PLAYER) {
      return claim.flags().has(ClaimFlag.PVP)
          ? Verdict.allow()
          : new Verdict.Deny(new Denial.NoPvp());
    }
    return switch (trust.trustOf(actor.player(), claim.townId())) {
      case OWNER, TRUSTED -> Verdict.allow();
      case OUTSIDER -> outsider(act, claim);
    };
  }

  private static Verdict outsider(Act act, Claim claim) {
    var open = OutsiderAccess.flagFor(act.action()).map(claim.flags()::has).orElse(false);
    return open
        ? Verdict.allow()
        : new Verdict.Deny(new Denial.ByTown(claim.townId(), act.action()));
  }
}
