package com.shepherdjerred.thestorm.essentials.testing;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.UUID;
import org.bukkit.Location;

/** Land protection with no claims: everything is allowed and all land has one owner. */
public final class AllowAllProtection implements Protection {

  @Override
  public Decision check(UUID player, ProtectedAction action, Location location) {
    return Decision.allowed();
  }

  @Override
  public Decision checkHarm(
      UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
    return Decision.allowed();
  }

  @Override
  public boolean sameLand(Location a, Location b) {
    return true;
  }
}
