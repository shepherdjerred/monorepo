package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Open invitations: which towns have invited which players, until when. Kept in memory only, so a
 * restart withdraws them. Main thread only.
 */
public final class Invitations {

  private final Duration expiry;
  private final Map<UUID, Map<UUID, Instant>> byInvitee = new HashMap<>();

  public Invitations(Duration expiry) {
    if (expiry.isNegative() || expiry.isZero()) {
      throw new IllegalArgumentException("invitations must last a while: " + expiry);
    }
    this.expiry = expiry;
  }

  /** Invites {@code invitee} to {@code town} at {@code now}, replacing an older invitation. */
  public void invite(UUID town, UUID invitee, Instant now) {
    byInvitee.computeIfAbsent(invitee, player -> new HashMap<>()).put(town, now.plus(expiry));
  }

  /** True when {@code invitee} holds an unexpired invitation from {@code town}. */
  public boolean isInvited(UUID town, UUID invitee, Instant now) {
    var invites = byInvitee.get(invitee);
    if (invites == null) {
      return false;
    }
    var until = invites.get(town);
    return until != null && now.isBefore(until);
  }

  /** Removes {@code invitee}'s invitation from {@code town}; true if it was still open. */
  public boolean withdraw(UUID town, UUID invitee, Instant now) {
    var open = isInvited(town, invitee, now);
    var invites = byInvitee.get(invitee);
    if (invites != null) {
      invites.remove(town);
      if (invites.isEmpty()) {
        byInvitee.remove(invitee);
      }
    }
    return open;
  }

  /** Every town whose invitation {@code invitee} may still accept. */
  public List<UUID> openFor(UUID invitee, Instant now) {
    var invites = byInvitee.getOrDefault(invitee, Map.of());
    return invites.entrySet().stream()
        .filter(entry -> now.isBefore(entry.getValue()))
        .map(Map.Entry::getKey)
        .sorted()
        .toList();
  }

  /** Forgets every invitation of {@code invitee}, for when they join a town. */
  public void forgetInvitee(UUID invitee) {
    byInvitee.remove(invitee);
  }

  /** Forgets every invitation from {@code town}, for when it is deleted. */
  public void forgetTown(UUID town) {
    byInvitee.values().forEach(invites -> invites.remove(town));
    byInvitee.values().removeIf(Map::isEmpty);
  }
}
