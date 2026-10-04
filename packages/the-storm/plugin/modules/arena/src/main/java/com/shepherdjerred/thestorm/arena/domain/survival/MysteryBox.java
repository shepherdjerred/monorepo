package com.shepherdjerred.thestorm.arena.domain.survival;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** One buyer, one reveal, one claim. Timed-out purchases return exactly one refund token. */
public final class MysteryBox {
  public record Roll(UUID owner, String reward, Instant reveal, Instant expires) {}

  private final List<String> sites;
  private int active;
  private int claims;
  private Optional<Roll> roll = Optional.empty();

  public MysteryBox(List<String> sites) {
    this.sites = List.copyOf(sites);
    if (sites.size() < 2 || sites.stream().distinct().count() != sites.size())
      throw new IllegalArgumentException("Mystery box needs distinct relocation sites");
  }

  public String site() {
    return sites.get(active);
  }

  public void reset() {
    active = 0;
    claims = 0;
    roll = Optional.empty();
  }

  public Optional<Roll> roll() {
    return roll;
  }

  public boolean start(UUID owner, String reward, Instant now) {
    if (roll.isPresent()) return false;
    roll = Optional.of(new Roll(owner, reward, now.plusSeconds(3), now.plusSeconds(18)));
    return true;
  }

  public boolean claim(UUID owner, Instant now) {
    if (roll.filter(
            r -> r.owner().equals(owner) && !now.isBefore(r.reveal()) && now.isBefore(r.expires()))
        .isEmpty()) return false;
    roll = Optional.empty();
    claims++;
    return true;
  }

  public Optional<Roll> expire(Instant now) {
    var expired = roll.filter(r -> !now.isBefore(r.expires()));
    if (expired.isPresent()) roll = Optional.empty();
    return expired;
  }

  public Optional<Roll> cancel(UUID owner) {
    var cancelled = roll.filter(r -> r.owner().equals(owner));
    if (cancelled.isPresent()) roll = Optional.empty();
    return cancelled;
  }

  public boolean relocate(int offset) {
    if (offset < 1 || offset >= sites.size())
      throw new IllegalArgumentException("Invalid site offset");
    if (claims < 6 || roll.isPresent()) return false;
    active = (active + offset) % sites.size();
    claims = 0;
    return true;
  }
}
