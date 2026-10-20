package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;

/**
 * One player's belongings for one side of a creative visit. The ender chest is part of the body:
 * the shared snapshot type does not carry it.
 *
 * @param role which side this body is
 * @param snapshot inventory, armor, off hand, cursor-settled contents, experience, effects and
 *     place
 * @param enderChest the ender chest, serialized the same way as the inventory
 */
public record VisitBody(BodyRole role, Snapshot snapshot, ItemData enderChest) {

  public VisitBody {
    if (!snapshot.scope().equals(role.wire())) {
      throw new IllegalArgumentException("body scope does not match its role");
    }
  }
}
