package com.shepherdjerred.thestorm.stats.domain;

import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * Deterministic state machine for human player sessions, interval splitting, and ping statistics.
 */
public final class SessionLedger {

  public static final ZoneId PACIFIC_ZONE = ZoneId.of("America/Los_Angeles");
  public static final long MAX_DURATION_MS = 31_536_000_000L;
  public static final int MAX_PING_MS = 60_000;

  private final Supplier<UUID> ids;
  private final Map<UUID, OpenSession> sessions = new LinkedHashMap<>();

  public SessionLedger(Supplier<UUID> ids) {
    this.ids = ids;
  }

  public record JoinInput(
      UUID playerUuid,
      String playerName,
      Instant at,
      Platform platform,
      String clientVersion,
      @Nullable String clientBrand,
      @Nullable String joinAddress,
      WorldBucket world,
      GameModeBucket mode,
      boolean afk,
      @Nullable String countryCode,
      @Nullable String countryName) {
    public JoinInput {
      playerName = CombatClassifier.boundName(playerName);
      clientVersion = boundString(clientVersion, 64, "unknown");
      clientBrand = nullableBoundString(clientBrand, 64);
      joinAddress = JoinAddresses.normalize(joinAddress);
      countryCode = normalizeCountryCode(countryCode);
      countryName = countryCode == null ? null : nullableBoundString(countryName, 80);
    }
  }

  public record StateSample(
      Instant at, WorldBucket world, GameModeBucket mode, boolean afk, @Nullable Integer pingMs) {}

  public record LeaveInput(
      UUID playerUuid, Instant at, EndReason endReason, @Nullable Integer pingMs) {}

  public record OpenSessionView(
      UUID sessionId,
      UUID playerUuid,
      String playerName,
      Instant startedAt,
      Instant checkpointAt,
      long connectedMs,
      long activeMs,
      WorldBucket world,
      GameModeBucket mode,
      boolean afk) {}

  public sealed interface LedgerEvent {
    UUID eventId();

    Instant occurredAt();

    record Started(
        UUID eventId,
        Instant occurredAt,
        UUID sessionId,
        UUID playerUuid,
        String playerName,
        Platform platform,
        String clientVersion,
        @Nullable String clientBrand,
        @Nullable String joinAddress,
        @Nullable String countryCode,
        @Nullable String countryName)
        implements LedgerEvent {}

    record Interval(
        UUID eventId,
        Instant occurredAt,
        Instant intervalEnd,
        UUID sessionId,
        UUID playerUuid,
        String playerName,
        WorldBucket world,
        GameModeBucket mode,
        long connectedMs,
        long activeMs,
        @Nullable Integer pingMs)
        implements LedgerEvent {}

    record Ended(
        UUID eventId,
        Instant occurredAt,
        UUID sessionId,
        UUID playerUuid,
        String playerName,
        Instant startedAt,
        long connectedMs,
        long activeMs,
        EndReason endReason,
        @Nullable Integer pingMinMs,
        @Nullable Integer pingAvgMs,
        @Nullable Integer pingMaxMs)
        implements LedgerEvent {}
  }

  public record LedgerTransition(
      UUID playerUuid,
      String playerName,
      Instant seenAt,
      long connectedMsDelta,
      long activeMsDelta,
      int sessionsDelta,
      @Nullable OpenSessionView openSession,
      @Nullable UUID closedSessionId,
      List<LedgerEvent> events) {
    public LedgerTransition {
      events = List.copyOf(events);
    }
  }

  public Optional<LedgerTransition> join(JoinInput input) {
    if (sessions.containsKey(input.playerUuid())) {
      return Optional.empty();
    }
    var sessionId = ids.get();
    var at = truncateMillis(input.at());
    var session = new OpenSession(sessionId, input, at);
    sessions.put(input.playerUuid(), session);
    var started =
        new LedgerEvent.Started(
            ids.get(),
            at,
            sessionId,
            input.playerUuid(),
            input.playerName(),
            input.platform(),
            input.clientVersion(),
            input.clientBrand(),
            input.joinAddress(),
            input.countryCode(),
            input.countryName());
    return Optional.of(
        new LedgerTransition(
            input.playerUuid(),
            input.playerName(),
            at,
            0L,
            0L,
            1,
            session.view(),
            null,
            List.of(started)));
  }

  /** Splits an interval only when world, mode, or AFK state actually changes. */
  public Optional<LedgerTransition> update(UUID playerUuid, StateSample sample) {
    var session = sessions.get(playerUuid);
    if (session == null) {
      return Optional.empty();
    }
    if (session.world == sample.world()
        && session.mode == sample.mode()
        && session.afk == sample.afk()) {
      session.observePing(sample.pingMs());
      return Optional.empty();
    }
    var delta = advance(session, truncateMillis(sample.at()), sample.pingMs());
    session.world = sample.world();
    session.mode = sample.mode();
    session.afk = sample.afk();
    if (delta.events().isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(
        new LedgerTransition(
            session.playerUuid,
            session.playerName,
            session.checkpointAt,
            delta.connectedMs(),
            delta.activeMs(),
            0,
            session.view(),
            null,
            delta.events()));
  }

  /** Splits an interval immediately when AFK state changes without touching Paper APIs. */
  public Optional<LedgerTransition> updateAfk(UUID playerUuid, Instant at, boolean afk) {
    var session = sessions.get(playerUuid);
    if (session == null || session.afk == afk) {
      return Optional.empty();
    }
    var delta = advance(session, truncateMillis(at), null);
    session.afk = afk;
    if (delta.events().isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(
        new LedgerTransition(
            session.playerUuid,
            session.playerName,
            session.checkpointAt,
            delta.connectedMs(),
            delta.activeMs(),
            0,
            session.view(),
            null,
            delta.events()));
  }

  /** Periodic checkpoint tick across an online player's current state. */
  public Optional<LedgerTransition> checkpoint(UUID playerUuid, StateSample sample) {
    var session = sessions.get(playerUuid);
    if (session == null) {
      return Optional.empty();
    }
    var delta = advance(session, truncateMillis(sample.at()), sample.pingMs());
    session.world = sample.world();
    session.mode = sample.mode();
    session.afk = sample.afk();
    if (delta.events().isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(
        new LedgerTransition(
            session.playerUuid,
            session.playerName,
            session.checkpointAt,
            delta.connectedMs(),
            delta.activeMs(),
            0,
            session.view(),
            null,
            delta.events()));
  }

  public Optional<LedgerTransition> leave(LeaveInput input) {
    var session = sessions.remove(input.playerUuid());
    if (session == null) {
      return Optional.empty();
    }
    var delta = advance(session, truncateMillis(input.at()), input.pingMs());
    var events = new ArrayList<>(delta.events());
    events.add(
        new LedgerEvent.Ended(
            ids.get(),
            session.checkpointAt,
            session.sessionId,
            session.playerUuid,
            session.playerName,
            session.startedAt,
            clampDuration(session.connectedMs),
            clampDuration(session.activeMs),
            input.endReason(),
            session.pingMin(),
            session.pingAvg(),
            session.pingMax()));
    return Optional.of(
        new LedgerTransition(
            session.playerUuid,
            session.playerName,
            session.checkpointAt,
            delta.connectedMs(),
            delta.activeMs(),
            0,
            null,
            session.sessionId,
            events));
  }

  public List<LedgerTransition> shutdown(Instant at) {
    var results = new ArrayList<LedgerTransition>();
    for (var playerUuid : List.copyOf(sessions.keySet())) {
      leave(new LeaveInput(playerUuid, at, EndReason.SHUTDOWN, null)).ifPresent(results::add);
    }
    return List.copyOf(results);
  }

  public Optional<OpenSessionView> sessionOf(UUID playerUuid) {
    var session = sessions.get(playerUuid);
    return session == null ? Optional.empty() : Optional.of(session.view());
  }

  public void forget(UUID playerUuid) {
    sessions.remove(playerUuid);
  }

  public static long clampDuration(long ms) {
    return Math.clamp(ms, 0L, MAX_DURATION_MS);
  }

  public static @Nullable Integer clampPing(@Nullable Integer pingMs) {
    if (pingMs == null || pingMs < 0) {
      return null;
    }
    return Math.min(MAX_PING_MS, pingMs);
  }

  private AdvanceResult advance(OpenSession session, Instant target, @Nullable Integer pingMs) {
    var sampledPing = session.observePing(pingMs);
    if (!target.isAfter(session.checkpointAt)) {
      return new AdvanceResult(0L, 0L, List.of());
    }
    var events = new ArrayList<LedgerEvent>();
    long connectedAdded = 0L;
    long activeAdded = 0L;
    while (session.checkpointAt.isBefore(target)) {
      var from = session.checkpointAt;
      var midnight =
          from.atZone(PACIFIC_ZONE)
              .toLocalDate()
              .plusDays(1)
              .atStartOfDay(PACIFIC_ZONE)
              .toInstant();
      var until = target.isBefore(midnight) ? target : midnight;
      long rawConnected = Math.max(0L, until.toEpochMilli() - from.toEpochMilli());
      long connected = clampDuration(rawConnected);
      long active = session.afk ? 0L : connected;
      session.connectedMs = clampDuration(session.connectedMs + connected);
      session.activeMs = clampDuration(session.activeMs + active);
      session.checkpointAt = until;
      connectedAdded += connected;
      activeAdded += active;
      if (connected > 0L) {
        events.add(
            new LedgerEvent.Interval(
                ids.get(),
                from,
                until,
                session.sessionId,
                session.playerUuid,
                session.playerName,
                session.world,
                session.mode,
                connected,
                active,
                sampledPing));
      }
    }
    return new AdvanceResult(connectedAdded, activeAdded, events);
  }

  private static Instant truncateMillis(Instant instant) {
    return Instant.ofEpochMilli(instant.toEpochMilli());
  }

  private static String boundString(String value, int max, String fallback) {
    var stripped = value.strip();
    if (stripped.isEmpty()) {
      return fallback;
    }
    return stripped.length() > max ? stripped.substring(0, max) : stripped;
  }

  private static @Nullable String nullableBoundString(@Nullable String value, int max) {
    if (value == null) {
      return null;
    }
    var stripped = value.strip();
    if (stripped.isEmpty()) {
      return null;
    }
    return stripped.length() > max ? stripped.substring(0, max) : stripped;
  }

  private static @Nullable String normalizeCountryCode(@Nullable String value) {
    if (value == null) {
      return null;
    }
    var normalized = value.strip().toUpperCase(Locale.ROOT);
    if (normalized.length() != 2
        || normalized.charAt(0) < 'A'
        || normalized.charAt(0) > 'Z'
        || normalized.charAt(1) < 'A'
        || normalized.charAt(1) > 'Z') {
      return null;
    }
    return normalized;
  }

  private record AdvanceResult(long connectedMs, long activeMs, List<LedgerEvent> events) {}

  private static final class OpenSession {
    private final UUID sessionId;
    private final UUID playerUuid;
    private final String playerName;
    private final Instant startedAt;
    private Instant checkpointAt;
    private long connectedMs;
    private long activeMs;
    private WorldBucket world;
    private GameModeBucket mode;
    private boolean afk;
    private int pingMin = Integer.MAX_VALUE;
    private int pingMax = 0;
    private long pingSum = 0L;
    private int pingCount = 0;
    private boolean sawZeroPing;
    private @Nullable Integer lastPositivePing;

    OpenSession(UUID sessionId, JoinInput input, Instant at) {
      this.sessionId = sessionId;
      this.playerUuid = input.playerUuid();
      this.playerName = input.playerName();
      this.startedAt = at;
      this.checkpointAt = at;
      this.world = input.world();
      this.mode = input.mode();
      this.afk = input.afk();
    }

    @Nullable Integer observePing(@Nullable Integer rawPing) {
      var clamped = clampPing(rawPing);
      if (clamped == null) {
        return lastPositivePing != null ? lastPositivePing : (sawZeroPing ? 0 : null);
      }
      if (clamped > 0) {
        pingMin = Math.min(pingMin, clamped);
        pingMax = Math.max(pingMax, clamped);
        pingSum += clamped;
        pingCount++;
        lastPositivePing = clamped;
        return clamped;
      }
      sawZeroPing = true;
      return lastPositivePing != null ? lastPositivePing : 0;
    }

    @Nullable Integer pingMin() {
      if (pingCount > 0) {
        return pingMin;
      }
      return sawZeroPing ? 0 : null;
    }

    @Nullable Integer pingAvg() {
      if (pingCount > 0) {
        return Math.clamp(Math.round((double) pingSum / pingCount), 0, MAX_PING_MS);
      }
      return sawZeroPing ? 0 : null;
    }

    @Nullable Integer pingMax() {
      if (pingCount > 0) {
        return pingMax;
      }
      return sawZeroPing ? 0 : null;
    }

    OpenSessionView view() {
      return new OpenSessionView(
          sessionId,
          playerUuid,
          playerName,
          startedAt,
          checkpointAt,
          connectedMs,
          activeMs,
          world,
          mode,
          afk);
    }
  }
}
