package com.shepherdjerred.thestorm.core.analytics;

import java.time.Instant;
import java.time.InstantSource;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Serializes connection accounting, including AFK changes reported by asynchronous chat. */
final class SessionBook implements ProductAnalytics {
  static final ZoneId ZONE = ZoneId.of("America/Los_Angeles");
  private final InstantSource time;
  private final Supplier<UUID> ids;
  private final Consumer<AnalyticsWrite> persist;
  private final Map<UUID, Session> sessions = new HashMap<>();

  private static final class Session {
    private final UUID id;
    private final UUID player;
    private final String name;
    private final Instant started;
    private Instant checkpoint;
    private long connected;
    private long active;
    private Mode mode = Mode.SURVIVAL;
    private boolean away;

    Session(UUID id, UUID player, String name, Instant at) {
      this.id = id;
      this.player = player;
      this.name = name;
      this.started = at;
      this.checkpoint = at;
    }

    AnalyticsWrite.Connection snapshot(boolean ended) {
      return new AnalyticsWrite.Connection(
          id, player, name, started, checkpoint, connected, active, ended);
    }
  }

  SessionBook(InstantSource time, Supplier<UUID> ids, Consumer<AnalyticsWrite> persist) {
    this.time = time;
    this.ids = ids;
    this.persist = persist;
  }

  synchronized void joined(UUID player, String name) {
    if (sessions.containsKey(player)) return;
    var now = now();
    var session = new Session(ids.get(), player, name, now);
    sessions.put(player, session);
    persist.accept(
        new AnalyticsWrite(
            session.snapshot(false), List.of(event("storm_session_started", now, Map.of()))));
  }

  synchronized void left(UUID player, String reason) {
    var session = sessions.remove(player);
    if (session == null) return;
    var events = advance(session, now());
    events.add(
        event(
            "storm_session_ended",
            session.checkpoint,
            Map.of(
                "connected_ms",
                session.connected,
                "active_ms",
                session.active,
                "end_reason",
                reason)));
    persist.accept(new AnalyticsWrite(session.snapshot(true), events));
  }

  synchronized void checkpoint() {
    var now = now();
    for (var session : sessions.values()) {
      var events = advance(session, now);
      persist.accept(new AnalyticsWrite(session.snapshot(false), events));
    }
  }

  synchronized void stop() {
    for (var player : List.copyOf(sessions.keySet())) left(player, "shutdown");
  }

  @Override
  public synchronized void interaction(UUID player, Action action) {
    var session = sessions.get(player);
    if (session == null) return;
    var properties =
        Map.<String, Object>of(
            "feature", action.feature(), "action", action.action(), "mode", modeName(session.mode));
    persist.accept(
        new AnalyticsWrite(
            session.snapshot(false),
            List.of(event("storm_feature_interacted", now(), properties))));
  }

  @Override
  public synchronized void mode(UUID player, Mode mode) {
    var session = sessions.get(player);
    if (session == null || session.mode == mode) return;
    var events = advance(session, now());
    session.mode = mode;
    persist.accept(new AnalyticsWrite(session.snapshot(false), events));
  }

  @Override
  public synchronized void afk(UUID player, boolean away) {
    var session = sessions.get(player);
    if (session == null || session.away == away) return;
    var events = advance(session, now());
    session.away = away;
    persist.accept(new AnalyticsWrite(session.snapshot(false), events));
  }

  private List<AnalyticsEvent> advance(Session session, Instant to) {
    if (to.isBefore(session.checkpoint))
      throw new IllegalStateException("Analytics clock moved backwards");
    var events = new ArrayList<AnalyticsEvent>();
    while (session.checkpoint.isBefore(to)) {
      var from = session.checkpoint;
      var midnight = from.atZone(ZONE).toLocalDate().plusDays(1).atStartOfDay(ZONE).toInstant();
      var until = to.isBefore(midnight) ? to : midnight;
      var connected = until.toEpochMilli() - from.toEpochMilli();
      var active = session.away ? 0L : connected;
      session.connected += connected;
      session.active += active;
      session.checkpoint = until;
      events.add(
          event(
              "storm_playtime_recorded",
              from,
              Map.of(
                  "connected_ms",
                  connected,
                  "active_ms",
                  active,
                  "interval_end",
                  until.toString(),
                  "mode",
                  modeName(session.mode))));
    }
    return events;
  }

  private AnalyticsEvent event(String name, Instant at, Map<String, Object> properties) {
    return new AnalyticsEvent(ids.get(), name, at, properties);
  }

  private Instant now() {
    return Instant.ofEpochMilli(time.instant().toEpochMilli());
  }

  private static String modeName(Mode mode) {
    return mode.name().toLowerCase(Locale.ROOT);
  }
}
