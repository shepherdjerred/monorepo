package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Duration;

/**
 * How long membership offers stay open, from {@code towns.yml}.
 *
 * @param inviteExpiryMinutes how long an invitation may be accepted
 * @param transferConfirmSeconds how long an owner has to confirm handing their town over
 */
public record MembershipPolicy(long inviteExpiryMinutes, long transferConfirmSeconds) {

  public MembershipPolicy {
    if (inviteExpiryMinutes < 1) {
      throw new IllegalArgumentException("inviteExpiryMinutes must be at least 1");
    }
    if (transferConfirmSeconds < 1) {
      throw new IllegalArgumentException("transferConfirmSeconds must be at least 1");
    }
  }

  public Duration inviteExpiry() {
    return Duration.ofMinutes(inviteExpiryMinutes);
  }

  public Duration transferWindow() {
    return Duration.ofSeconds(transferConfirmSeconds);
  }
}
