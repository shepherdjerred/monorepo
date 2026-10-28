package com.shepherdjerred.thestorm.towns.domain.lock;

/** How a lock treats people who are not its owner and are not trusted on it. */
public enum LockType {
  /** Only the owner, trusted players, and any town share may use it. */
  PRIVATE,
  /** Anyone may use it. It stays locked, so nobody else can lock it. */
  PUBLIC,
  /** Anyone who has entered the password this session may use it. */
  PASSWORD,
  /** Other people may put items in, and may not take them out. */
  DONATION,
  /** Other people may take items out, and may not put them in. */
  SUPPLY,
  /** Other people may look, and may not put items in or take them out. */
  DISPLAY
}
