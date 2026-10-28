package com.shepherdjerred.thestorm.towns.domain.lock;

/** What a lock's owner trusts a player with. */
public enum LockGrant {
  /** Open it and take from it. */
  USE,
  /** Open it, and break it too. */
  MANAGE,
  /** Open it and edit who else is on the list. Cannot break it or remove the owner. */
  ADMIN,
}
