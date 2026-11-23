package com.shepherdjerred.thestorm.stats.app;

import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Canonical wire DTOs matching {@code packages/storm-stats/contracts/ingest-v1.json}. Every record
 * component name matches its JSON field name 1-to-1.
 */
public final class StatsWire {

  public static final int SCHEMA_VERSION = 1;
  public static final int MAX_EVENTS_PER_BATCH = 200;
  public static final int MAX_PLAYER_SNAPSHOTS_PER_BATCH = 100;

  private StatsWire() {}

  public record IngestBatch(
      int schemaVersion,
      String batchId,
      String serverName,
      String sentAt,
      List<Object> events,
      List<PlayerGameplaySnapshot> playerSnapshots,
      @Nullable ServerSnapshot serverSnapshot) {
    public IngestBatch {
      events = List.copyOf(events);
      playerSnapshots = List.copyOf(playerSnapshots);
    }
  }

  public sealed interface IngestEvent
      permits CombatWireEvent,
          ConnectionBounceEvent,
          SessionEndedEvent,
          SessionIntervalEvent,
          SessionStartedEvent {
    String type();

    String eventId();

    String occurredAt();
  }

  public record SessionStartedEvent(
      String type,
      String eventId,
      String occurredAt,
      String sessionId,
      String playerUuid,
      String playerName,
      String firstSeenAt,
      String platform,
      String clientVersion,
      @Nullable String clientBrand,
      @Nullable String joinAddress,
      @Nullable String countryCode,
      @Nullable String countryName)
      implements IngestEvent {}

  public record SessionIntervalEvent(
      String type,
      String eventId,
      String occurredAt,
      String intervalEnd,
      String sessionId,
      String playerUuid,
      String playerName,
      String world,
      String mode,
      long connectedMs,
      long activeMs,
      @Nullable Integer pingMs)
      implements IngestEvent {}

  public record SessionEndedEvent(
      String type,
      String eventId,
      String occurredAt,
      String sessionId,
      String playerUuid,
      String playerName,
      String startedAt,
      long connectedMs,
      long activeMs,
      String endReason,
      @Nullable Integer pingMinMs,
      @Nullable Integer pingAvgMs,
      @Nullable Integer pingMaxMs)
      implements IngestEvent {}

  public record CombatWireEvent(
      String type,
      String eventId,
      String occurredAt,
      @Nullable String sessionId,
      String combatKind,
      @Nullable String killerUuid,
      @Nullable String killerName,
      @Nullable String victimUuid,
      @Nullable String victimName,
      @Nullable String mobType,
      String weapon,
      String world)
      implements IngestEvent {}

  public record ConnectionBounceEvent(
      String type,
      String eventId,
      String occurredAt,
      @Nullable String playerUuid,
      String playerName,
      String category,
      String reason,
      @Nullable String joinAddress)
      implements IngestEvent {}

  public record PlayerGameplaySnapshot(
      String playerUuid,
      String playerName,
      String capturedAt,
      @Nullable String nickname,
      String primaryGroup,
      long coins,
      @Nullable String townName,
      @Nullable String townRole,
      int townClaims,
      int powerLevel,
      @Nullable String topSkill,
      int topSkillLevel,
      Map<String, Integer> skills,
      @Nullable Map<String, Integer> tracks,
      @Nullable Integer questsCompleted,
      Map<String, Integer> arenaBestWaves,
      int rwfMatches,
      int rwfWins,
      int rwfLosses,
      int rwfKills,
      int rwfDeaths) {
    public PlayerGameplaySnapshot {
      skills = Map.copyOf(skills);
      tracks = tracks == null ? null : Map.copyOf(tracks);
      arenaBestWaves = Map.copyOf(arenaBestWaves);
    }
  }

  public record OnlinePlayerSummary(
      String uuid,
      String name,
      String mode,
      String world,
      boolean afk,
      @Nullable Integer pingMs,
      String sessionStartedAt) {}

  public record TownSummarySnapshot(String name, int members, int claims, String kind) {}

  public record ServerSnapshot(
      String capturedAt,
      List<OnlinePlayerSummary> onlinePlayers,
      int maxPlayers,
      int townsCount,
      List<TownSummarySnapshot> towns) {
    public ServerSnapshot {
      onlinePlayers = List.copyOf(onlinePlayers);
      towns = List.copyOf(towns);
    }
  }
}
