package com.shepherdjerred.thestorm.discord.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where links are kept. Futures complete off the main thread. */
public interface LinkStore {

  /** Every link, for the in-memory view at enable. */
  CompletableFuture<List<Links.Link>> all();

  /** Saves {@code link}, replacing any link either side already had. */
  CompletableFuture<Void> link(Links.Link link, Instant at);

  /** Removes {@code player}'s link; true if there was one. */
  CompletableFuture<Boolean> unlinkPlayer(UUID player);

  /** Removes {@code discordUser}'s link; true if there was one. */
  CompletableFuture<Boolean> unlinkDiscord(long discordUser);

  /** Turns result DMs on or off; true if {@code player} is linked. */
  CompletableFuture<Boolean> setDms(UUID player, boolean on);
}
