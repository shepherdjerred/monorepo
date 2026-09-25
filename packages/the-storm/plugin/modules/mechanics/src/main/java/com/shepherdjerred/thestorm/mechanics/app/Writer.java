package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.core.protection.Decision;

/** The player writing a sign, as creation sees them. */
public interface Writer {

  boolean hasPermission(String permission);

  /** Whether land protection lets them build where the sign is. Asked only for mechanism signs. */
  Decision mayBuildHere();
}
