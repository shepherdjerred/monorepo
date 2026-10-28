package com.shepherdjerred.thestorm.qol.domain.bank;

import java.util.Map;
import java.util.UUID;

/** Who may act on a bank besides the land and lock checks. */
public final class BankAccess {

  private BankAccess() {}

  /**
   * Whether {@code actor} may do {@code needed}. The owner always may. {@code admin} is the staff
   * override. Anyone else uses their grant, or {@code fallback} when they have none.
   */
  public record Query(
      UUID actor,
      UUID owner,
      Map<UUID, BankRole> grants,
      BankRole needed,
      BankRole fallback,
      boolean admin) {}

  public static boolean allowed(Query query) {
    if (query.admin() || query.actor().equals(query.owner())) {
      return true;
    }
    return query.grants().getOrDefault(query.actor(), query.fallback()).includes(query.needed());
  }
}
