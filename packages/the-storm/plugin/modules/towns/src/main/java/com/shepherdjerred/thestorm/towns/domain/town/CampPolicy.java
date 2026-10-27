package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Duration;

/**
 * How camps behave, from {@code towns.yml}.
 *
 * @param chunks the most chunks one camp may hold
 * @param members the most people in a camp, including the owner
 * @param idleDays how long a camp lasts after its last member was seen
 * @param warnDays how long before that a member who is online is warned
 * @param settleBlocks solid blocks placed in one chunk that count as starting a house
 * @param settleStayMinutes how long they must stay nearby before that block count counts
 */
public record CampPolicy(
    int chunks, int members, int idleDays, int warnDays, int settleBlocks, int settleStayMinutes) {

  public CampPolicy {
    if (chunks < 1 || chunks > 256) {
      throw new IllegalArgumentException("camp chunks must be 1..256: " + chunks);
    }
    if (members < 1 || members > 100) {
      throw new IllegalArgumentException("camp members must be 1..100: " + members);
    }
    if (idleDays < 1) {
      throw new IllegalArgumentException("camp idleDays must be at least 1");
    }
    if (warnDays < 0 || warnDays >= idleDays) {
      throw new IllegalArgumentException("camp warnDays must be at least 0 and below idleDays");
    }
    if (settleBlocks < 1) {
      throw new IllegalArgumentException("camp settleBlocks must be at least 1");
    }
    if (settleStayMinutes < 0) {
      throw new IllegalArgumentException("camp settleStayMinutes must not be negative");
    }
  }

  public Duration idle() {
    return Duration.ofDays(idleDays);
  }

  public Duration warn() {
    return Duration.ofDays(warnDays);
  }

  public Duration settleStay() {
    return Duration.ofMinutes(settleStayMinutes);
  }
}
