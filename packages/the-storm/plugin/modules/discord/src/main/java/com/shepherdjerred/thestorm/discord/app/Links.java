package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.discord.domain.PendingLinks;
import java.time.InstantSource;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.random.RandomGenerator;

/**
 * Discord accounts linked to players. A Discord user asks for a code with {@code /link} and types
 * it in game; the link is saved, then kept in memory so posts never wait on the database.
 * Thread-safe.
 */
public final class Links implements LinkedAccounts {

  /**
   * One link.
   *
   * @param player the Minecraft player
   * @param discordUser their Discord user id
   * @param dms whether they want their own results by direct message
   */
  public record Link(UUID player, long discordUser, boolean dms) {}

  private final LinkStore store;
  private final PendingLinks pending;
  private final InstantSource time;
  private final RandomGenerator random;
  private final Map<UUID, Link> byPlayer = new ConcurrentHashMap<>();

  public Links(LinkStore store, PendingLinks pending, InstantSource time, RandomGenerator random) {
    this.store = store;
    this.pending = pending;
    this.time = time;
    this.random = random;
  }

  /** Loads every saved link. */
  public CompletableFuture<Void> load() {
    return store.all().thenAccept(all -> all.forEach(link -> byPlayer.put(link.player(), link)));
  }

  /** A code for {@code discordUser} to type in game with {@code /discord link}. */
  public String start(long discordUser) {
    synchronized (random) {
      return pending.start(discordUser, time.instant(), random);
    }
  }

  /** How long a code lasts, in whole minutes. */
  public long codeMinutes() {
    return pending.ttl().toMinutes();
  }

  /** Links {@code player} to whoever was issued {@code code}; empty for an unknown or old code. */
  public CompletableFuture<Optional<Link>> confirm(UUID player, String code) {
    var discordUser = pending.redeem(code, time.instant());
    if (discordUser.isEmpty()) {
      return CompletableFuture.completedFuture(Optional.empty());
    }
    var link = new Link(player, discordUser.orElseThrow(), false);
    return store
        .link(link, time.instant())
        .thenApply(
            saved -> {
              byPlayer.values().removeIf(old -> old.discordUser() == link.discordUser());
              byPlayer.put(player, link);
              return Optional.of(link);
            });
  }

  /** Unlinks {@code player}; true if they were linked. */
  public CompletableFuture<Boolean> unlink(UUID player) {
    return store
        .unlinkPlayer(player)
        .thenApply(
            removed -> {
              byPlayer.remove(player);
              return removed;
            });
  }

  /** Unlinks {@code discordUser}; true if they were linked. */
  public CompletableFuture<Boolean> unlinkDiscord(long discordUser) {
    return store
        .unlinkDiscord(discordUser)
        .thenApply(
            removed -> {
              byPlayer.values().removeIf(link -> link.discordUser() == discordUser);
              return removed;
            });
  }

  /** Turns result DMs on or off; false if {@code player} is not linked. */
  public CompletableFuture<Boolean> setDms(UUID player, boolean on) {
    return store
        .setDms(player, on)
        .thenApply(
            linked -> {
              if (linked) {
                byPlayer.computeIfPresent(
                    player, (id, link) -> new Link(id, link.discordUser(), on));
              }
              return linked;
            });
  }

  /** {@code player}'s link, if any. */
  public Optional<Link> of(UUID player) {
    return Optional.ofNullable(byPlayer.get(player));
  }

  @Override
  public Optional<UUID> playerOf(long discordUser) {
    return byPlayer.values().stream()
        .filter(link -> link.discordUser() == discordUser)
        .map(Link::player)
        .findFirst();
  }

  /** Where to DM {@code player}'s results: their Discord user, if linked with DMs on. */
  @Override
  public Optional<Long> dmTarget(UUID player) {
    return of(player).filter(Link::dms).map(Link::discordUser);
  }
}
