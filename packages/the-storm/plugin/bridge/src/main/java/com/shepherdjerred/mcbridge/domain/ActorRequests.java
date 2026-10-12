package com.shepherdjerred.mcbridge.domain;

import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** Validated bodies of the {@code /v1/actors} routes; they mirror the zod schemas. */
public final class ActorRequests {
  /** Default and bounds of a {@code goto} wait. */
  public static final Duration DEFAULT_GOTO_TIMEOUT = Duration.ofSeconds(30);

  private static final long MIN_GOTO_MS = 1_000;
  private static final long MAX_GOTO_MS = 120_000;
  private static final double DEFAULT_RANGE = 1.0;
  private static final double MIN_RANGE = 0.5;
  private static final double MAX_RANGE = 16.0;
  private static final int MAX_CHAT = 256;

  private ActorRequests() {}

  /** The game modes an actor may be spawned in. */
  public enum Mode {
    SURVIVAL,
    CREATIVE,
    ADVENTURE,
    SPECTATOR;

    /** Parses the exact wire value (upper case). */
    public static Mode parse(String wire) {
      for (Mode mode : values()) {
        if (mode.name().equals(wire)) {
          return mode;
        }
      }
      throw BridgeException.badRequest(
          "gameMode must be SURVIVAL, CREATIVE, ADVENTURE or SPECTATOR: " + wire);
    }
  }

  /** Where {@code equip} puts the item. */
  public enum Slot {
    HAND,
    OFFHAND,
    HEAD,
    CHEST,
    LEGS,
    FEET;

    /** Parses the lower-case wire value. */
    public static Slot parse(String wire) {
      for (Slot slot : values()) {
        if (slot.name().toLowerCase(Locale.ROOT).equals(wire)) {
          return slot;
        }
      }
      throw BridgeException.badRequest(
          "slot must be hand, offhand, head, chest, legs or feet: " + wire);
    }
  }

  /** {@code POST /v1/actors}. */
  public record Spawn(ActorName name, String world, BlockPos at, Mode mode, boolean op) {}

  /** {@code POST /v1/actors/:name/goto}: arrive within {@code range} blocks or give up. */
  public record Goto(BlockPos pos, double range, Duration timeout) {
    public Goto {
      if (!(range >= MIN_RANGE && range <= MAX_RANGE)) {
        throw BridgeException.badRequest("range must be " + MIN_RANGE + ".." + MAX_RANGE);
      }
      long millis = timeout.toMillis();
      if (millis < MIN_GOTO_MS || millis > MAX_GOTO_MS) {
        throw BridgeException.badRequest("timeoutMs must be " + MIN_GOTO_MS + ".." + MAX_GOTO_MS);
      }
    }

    /** Applies the defaults for absent optional fields. */
    public static Goto of(BlockPos pos, Optional<Double> range, Optional<Integer> timeoutMs) {
      return new Goto(
          pos,
          range.orElse(DEFAULT_RANGE),
          timeoutMs.map(Duration::ofMillis).orElse(DEFAULT_GOTO_TIMEOUT));
    }
  }

  /** {@code POST /v1/actors/:name/equip}. */
  public record Equip(String item, int count, Slot slot) {
    public Equip {
      if (count < 1 || count > 64) {
        throw BridgeException.badRequest("count must be 1..64");
      }
    }
  }

  /** {@code POST /v1/actors/:name/chat}. */
  public record Chat(String message) {
    public Chat {
      if (message.isEmpty() || message.length() > MAX_CHAT) {
        throw BridgeException.badRequest("message must be 1.." + MAX_CHAT + " characters");
      }
    }
  }

  /** {@code POST /v1/actors/:name/attack}: one entity by UUID, or the nearest of a type. */
  public sealed interface AttackTarget {
    /** A specific entity. */
    record ById(UUID id) implements AttackTarget {}

    /** The nearest entity of a namespaced type within reach of the actor. */
    record NearestOfType(String type) implements AttackTarget {}

    /** Exactly one of {@code entity} and {@code type} must be present. */
    static AttackTarget of(Optional<String> entity, Optional<String> type) {
      if (entity.isPresent() == type.isPresent()) {
        throw BridgeException.badRequest("attack needs exactly one of entity or type");
      }
      if (entity.isPresent()) {
        try {
          return new ById(UUID.fromString(entity.get()));
        } catch (IllegalArgumentException e) {
          throw BridgeException.badRequest("entity must be a UUID: " + entity.get());
        }
      }
      return new NearestOfType(type.orElseThrow());
    }
  }

  /** Builds an {@link AttackTarget}; see {@link AttackTarget#of}. */
  public static AttackTarget attackTarget(Optional<String> entity, Optional<String> type) {
    return AttackTarget.of(entity, type);
  }
}
