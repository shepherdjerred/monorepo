package com.shepherdjerred.thestorm.arena.domain.survival;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** One run's participant; downed players retain their gear until bleedout. */
public record Survivor(
    UUID id,
    String name,
    SurvivalClass role,
    Status status,
    boolean ready,
    boolean selfRevive,
    Optional<Instant> bleedout) {
  public enum Status {
    JOINING,
    LOBBY,
    STANDING,
    DOWNED,
    WAITING,
    SPECTATOR
  }

  public Survivor {
    if ((status == Status.DOWNED) != bleedout.isPresent()) {
      throw new IllegalArgumentException("Only a downed survivor has a bleedout deadline");
    }
  }

  public Survivor status(Status next) {
    return new Survivor(id, name, role, next, ready, selfRevive, Optional.empty());
  }

  public Survivor select(SurvivalClass next) {
    return new Survivor(id, name, next, status, false, selfRevive, bleedout);
  }

  public Survivor markReady() {
    return new Survivor(id, name, role, status, true, selfRevive, bleedout);
  }

  public Survivor down(Instant now) {
    return new Survivor(
        id, name, role, Status.DOWNED, ready, selfRevive, Optional.of(now.plusSeconds(30)));
  }

  public Survivor revived(boolean consume) {
    return new Survivor(
        id, name, role, Status.STANDING, ready, selfRevive && !consume, Optional.empty());
  }
}
