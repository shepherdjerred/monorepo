package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;

/**
 * A land-protection port with one claim: everything at x >= 0 is Aegis's town, where only its
 * residents may build, PvP is off and animals are protected from outsiders. West of x = 0 is
 * wilderness: anyone may build and PvP is on. The contract follows the real port: harming a player
 * needs PvP on both the attacker's and the victim's land.
 */
final class FakeProtection implements Protection {

  static final Component AEGIS = Component.text("This land belongs to Aegis.");
  static final Component NO_PVP = Component.text("PvP is off here.");

  final Set<UUID> residents = new HashSet<>();
  final List<ProtectedAction> actions = new ArrayList<>();
  final List<HarmTarget> harms = new ArrayList<>();

  static boolean inClaim(Location location) {
    return location.getX() >= 0;
  }

  @Override
  public Decision check(UUID player, ProtectedAction action, Location location) {
    actions.add(action);
    return inClaim(location) && !residents.contains(player)
        ? new Decision.Denied(AEGIS)
        : Decision.allowed();
  }

  @Override
  public Decision checkHarm(
      UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
    harms.add(target);
    return switch (target) {
      case PLAYER ->
          inClaim(attackerAt) || inClaim(victimAt)
              ? new Decision.Denied(NO_PVP)
              : Decision.allowed();
      case PASSIVE ->
          inClaim(victimAt) && !residents.contains(attacker)
              ? new Decision.Denied(AEGIS)
              : Decision.allowed();
    };
  }
}
