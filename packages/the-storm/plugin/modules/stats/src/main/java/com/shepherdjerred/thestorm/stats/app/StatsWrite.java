package com.shepherdjerred.thestorm.stats.app;

import com.shepherdjerred.thestorm.stats.domain.SessionLedger;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Atomic storage write unit combining player summary deltas, open-session state, and outbox rows.
 */
public record StatsWrite(
    List<PlayerDelta> playerDeltas,
    @Nullable OpenSessionRow openSession,
    @Nullable UUID closedSessionId,
    List<OutboxDraft> events) {

  public StatsWrite {
    playerDeltas = List.copyOf(playerDeltas);
    events = List.copyOf(events);
  }

  public record PlayerDelta(
      UUID playerUuid,
      String playerName,
      long seenAtMs,
      long connectedMsDelta,
      long activeMsDelta,
      int sessionsDelta,
      int pvpKillsDelta,
      int pvpDeathsDelta,
      int mobKillsDelta) {}

  public record OpenSessionRow(
      UUID sessionId,
      UUID playerUuid,
      String playerName,
      long startedMs,
      long checkpointMs,
      long connectedMs,
      long activeMs) {
    public static OpenSessionRow fromView(SessionLedger.OpenSessionView view) {
      return new OpenSessionRow(
          view.sessionId(),
          view.playerUuid(),
          view.playerName(),
          view.startedAt().toEpochMilli(),
          view.checkpointAt().toEpochMilli(),
          view.connectedMs(),
          view.activeMs());
    }
  }

  public sealed interface OutboxDraft {
    UUID eventId();

    Instant occurredAt();

    record Ready(UUID eventId, Instant occurredAt, StatsWire.IngestEvent wireEvent)
        implements OutboxDraft {}

    record SessionStartNeedsFirstSeen(
        UUID eventId,
        Instant occurredAt,
        UUID sessionId,
        UUID playerUuid,
        String playerName,
        String platform,
        String clientVersion,
        @Nullable String clientBrand,
        @Nullable String joinAddress,
        @Nullable String countryCode,
        @Nullable String countryName)
        implements OutboxDraft {}
  }
}
