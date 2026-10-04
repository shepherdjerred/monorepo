package com.shepherdjerred.thestorm.towns.domain.parcel;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.util.Set;
import java.util.UUID;

/** Rights resolved with the current clock; parent safety survives owner build permission. */
public record ProtectedParcel(
    ParcelDefinition definition, Set<UUID> owners, Phase phase, RegionProfile profile) {

  public enum Phase {
    ACTIVE,
    GRACE,
    RESETTING,
    UNOWNED
  }

  public ProtectedParcel {
    owners = Set.copyOf(owners);
  }

  public boolean permits(UUID player, Act act) {
    if (act.action() == Action.ATTACK_PLAYER) {
      return false;
    }
    if (act.action() == Action.TELEPORT_INTO) {
      return true;
    }
    if (owners.contains(player)) {
      return phase == Phase.ACTIVE
          || (phase == Phase.GRACE && act.action() == Action.OPEN_CONTAINER);
    }
    return phase != Phase.RESETTING
        && act.action() == Action.INTERACT
        && Set.of(
                Subject.DOOR,
                Subject.TRAPDOOR,
                Subject.FENCE_GATE,
                Subject.BUTTON,
                Subject.LEVER,
                Subject.PRESSURE_PLATE,
                Subject.BELL)
            .contains(act.subject());
  }
}
