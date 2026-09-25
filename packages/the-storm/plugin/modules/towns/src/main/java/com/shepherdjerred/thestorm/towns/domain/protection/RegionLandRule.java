package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;

/** An admin region: ordinary players may do only what the region's allowances list. */
final class RegionLandRule {

  private RegionLandRule() {}

  static Verdict decide(Act act, AdminRegion region) {
    if (region.permits(act)) {
      return Verdict.allow();
    }
    return new Verdict.Deny(
        act.action() == Action.ATTACK_PLAYER
            ? new Denial.NoPvp()
            : new Denial.ByRegion(region.name(), act.action()));
  }
}
