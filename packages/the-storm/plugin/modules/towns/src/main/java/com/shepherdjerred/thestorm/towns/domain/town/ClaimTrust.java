package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import java.util.UUID;

/**
 * How far a claim trusts a player: members by their rank; players the claim trusts (see {@code
 * /claim trust}) for building, containers and switches on that one chunk; everyone else not at all.
 */
public final class ClaimTrust {

  private ClaimTrust() {}

  /** How far {@code claim}, held by {@code town}, trusts {@code player} for {@code act}. */
  public static TrustLevel of(Town town, Claim claim, UUID player, Act act) {
    if (!town.id().equals(claim.townId())) {
      throw new IllegalArgumentException(town.name() + " does not hold " + claim.chunk());
    }
    var role = town.roleOf(player);
    if (role.isPresent()) {
      return role.get().trust();
    }
    return claim.trusted().contains(player) && coveredByClaimTrust(act.action())
        ? TrustLevel.TRUSTED
        : TrustLevel.OUTSIDER;
  }

  /**
   * True for what claim trust grants: building and breaking, containers, and doors, switches and
   * redstone. Animals and villagers, teleports and homes stay the town's own.
   */
  public static boolean coveredByClaimTrust(Action action) {
    return switch (action) {
      case BUILD, BREAK, PLACE_ENTITY, OPEN_CONTAINER, INTERACT, USE_REDSTONE -> true;
      case DAMAGE_ENTITY, INTERACT_ENTITY, ATTACK_PLAYER, TELEPORT_INTO, SET_HOME -> false;
    };
  }
}
