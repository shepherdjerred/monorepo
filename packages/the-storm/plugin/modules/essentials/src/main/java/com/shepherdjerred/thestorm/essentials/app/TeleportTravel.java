package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Shared command travel; callers prepare destinations without owning payment or cooldowns. */
public interface TeleportTravel {
  /** Called on the main thread. Preparation starts only after reserving and checking cooldowns. */
  void travel(
      Player player,
      TeleportKind kind,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation);

  Policy policy();

  /** Wilderness preparation through the same travel policy as the built-in commands. */
  void randomTeleport(
      Player player,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation);

  /**
   * A free, immediate teleport. Used by the starter compass. It does not quote, charge, warm up, or
   * start a command cooldown.
   */
  void complimentary(
      Player player,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation);

  /** Travel to a server destination, such as another world's spawn, priced as a warp. */
  void warp(
      Player player,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation);

  CompletableFuture<Status> status(Player player);

  record Policy(java.time.Duration rtpFreeFor) {}

  /** Supply the existing RTP first-seen source and its legacy payment recovery gate once. */
  void configureRtp(
      Function<UUID, CompletableFuture<Instant>> firstSeen, CompletableFuture<Void> recovered);

  /**
   * Destination resources stay held until delivery or failure; callbacks run on the main thread.
   */
  record Landing(
      Location location,
      Runnable release,
      Runnable arrived,
      @org.jspecify.annotations.Nullable BiMove move) {
    public Landing(Location location, Runnable release, Runnable arrived) {
      this(location, release, arrived, null);
    }
  }

  /** Optional transport for a prepared trip, after the normal player travel guards pass. */
  @FunctionalInterface
  interface BiMove {
    CompletableFuture<Boolean> move(Player player, Location destination);
  }

  record Status(
      TeleportPricing rules,
      TeleportUsage history,
      Map<TeleportKind, Quote> quotes,
      Instant now,
      Instant rtpFreeUntil) {
    public Status {
      quotes = Map.copyOf(quotes);
      if (!quotes.keySet().equals(java.util.EnumSet.allOf(TeleportKind.class))) {
        throw new IllegalArgumentException("status requires every teleport category");
      }
    }

    public Quote quote(TeleportKind kind) {
      return java.util.Objects.requireNonNull(quotes.get(kind));
    }
  }
}
