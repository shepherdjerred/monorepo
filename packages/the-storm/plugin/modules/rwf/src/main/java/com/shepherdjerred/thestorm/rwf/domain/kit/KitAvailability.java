// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitAvailibility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

/** Who may pick a kit. */
public enum KitAvailability {
  /** Everyone. */
  FREE,
  /** Whoever has bought it for its price. */
  PURCHASE,
  /** Nobody but the owner; kept for kits still being balanced. */
  LOCKED,
  /** Staff only. */
  STAFF,
}
