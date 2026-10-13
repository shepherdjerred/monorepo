// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/Kit.java, ownsKit); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.Optional;
import java.util.Set;

/**
 * Which kits one combatant may pick. Free kits are open to everyone; a bought kit is open to
 * whoever owns it, and to everyone in the week it rotates free. While the expanded kit list is
 * switched off for a player, only The Storm's first four kits are offered to them at all.
 *
 * @param everything whether every kit is open, as for bots, which own nothing
 * @param expanded whether the full kit list is offered
 * @param owned the bought kits they own
 * @param freeThisWeek the bought kits free this week
 */
public record KitAccess(
    boolean everything, boolean expanded, Set<String> owned, Set<String> freeThisWeek) {

  /** Every kit open: bots draft kits from their own allow-list and own nothing. */
  public static final KitAccess EVERYTHING = new KitAccess(true, true, Set.of(), Set.of());

  /** Only the first four kits; the rest of the list is switched off. */
  public static final KitAccess MILESTONE_ONE = new KitAccess(false, false, Set.of(), Set.of());

  public KitAccess {
    owned = Set.copyOf(owned);
    freeThisWeek = Set.copyOf(freeThisWeek);
  }

  /** The full list, with {@code owned} bought and {@code freeThisWeek} rotating free. */
  public static KitAccess of(Set<String> owned, Set<String> freeThisWeek) {
    return new KitAccess(false, true, owned, freeThisWeek);
  }

  /** Why {@code kit} may not be picked, if it may not. */
  public Optional<Lock> lock(KitSpec kit) {
    if (everything) {
      return Optional.empty();
    }
    if (!expanded && !KitBook.MILESTONE_ONE.contains(kit)) {
      return Optional.of(Lock.UNAVAILABLE);
    }
    return switch (kit.availability()) {
      case FREE -> Optional.empty();
      case PURCHASE ->
          owned.contains(kit.id()) || freeThisWeek.contains(kit.id())
              ? Optional.empty()
              : Optional.of(Lock.NOT_OWNED);
      case LOCKED, STAFF -> Optional.of(Lock.UNAVAILABLE);
    };
  }

  public boolean allows(KitSpec kit) {
    return lock(kit).isEmpty();
  }

  /** Whether {@code kit} is open only because it rotates free this week. */
  public boolean borrowed(KitSpec kit) {
    return !everything
        && kit.purchasable()
        && freeThisWeek.contains(kit.id())
        && !owned.contains(kit.id());
  }

  /** Why a kit is closed. */
  public enum Lock {
    /** It is bought, and they have not bought it. */
    NOT_OWNED,
    /** It is not offered to them at all. */
    UNAVAILABLE,
  }
}
