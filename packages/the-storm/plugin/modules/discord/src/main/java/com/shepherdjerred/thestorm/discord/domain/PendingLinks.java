package com.shepherdjerred.thestorm.discord.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Short-lived codes a Discord user types in game to link their account. One code per Discord user;
 * a new one replaces the old. Thread-safe.
 */
public final class PendingLinks {

  /** Letters and digits that cannot be mistaken for one another. */
  static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  public static final int LENGTH = 6;

  private final Duration ttl;
  private final Map<String, Pending> byCode = new HashMap<>();

  public PendingLinks(Duration ttl) {
    if (ttl.isNegative() || ttl.isZero()) {
      throw new IllegalArgumentException("a link code must live for some time: " + ttl);
    }
    this.ttl = ttl;
  }

  public Duration ttl() {
    return ttl;
  }

  /** A fresh code for {@code discordUser}, replacing any earlier one. */
  public synchronized String start(long discordUser, Instant now, RandomGenerator random) {
    byCode.values().removeIf(pending -> pending.discordUser() == discordUser);
    byCode.values().removeIf(pending -> !now.isBefore(pending.expires()));
    String code;
    do {
      var out = new StringBuilder(LENGTH);
      for (var i = 0; i < LENGTH; i++) {
        out.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
      }
      code = out.toString();
    } while (byCode.containsKey(code));
    byCode.put(code, new Pending(discordUser, now.plus(ttl)));
    return code;
  }

  /** The Discord user {@code code} was issued to, if it is live; a code works once. */
  public synchronized Optional<Long> redeem(String code, Instant now) {
    var pending = byCode.remove(code.strip().toUpperCase(Locale.ROOT));
    if (pending == null || !now.isBefore(pending.expires())) {
      return Optional.empty();
    }
    return Optional.of(pending.discordUser());
  }

  private record Pending(long discordUser, Instant expires) {}
}
