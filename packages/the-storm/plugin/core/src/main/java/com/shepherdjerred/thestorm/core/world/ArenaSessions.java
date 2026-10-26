package com.shepherdjerred.thestorm.core.world;

import java.util.UUID;

/** Whether a player is inside an arena session. */
public interface ArenaSessions {
  boolean contains(UUID player);
}
