package com.shepherdjerred.thestorm.stats.app;

import com.shepherdjerred.thestorm.stats.domain.BounceCategory;
import com.shepherdjerred.thestorm.stats.domain.CombatClassifier;
import com.shepherdjerred.thestorm.stats.domain.CombatKind;
import com.shepherdjerred.thestorm.stats.domain.EndReason;
import com.shepherdjerred.thestorm.stats.domain.SessionLedger;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import tools.jackson.databind.json.JsonMapper;

/**
 * Coordinates session accounting, combat/bounce queueing, gameplay snapshot buffering, and bounded
 * single-flight HTTP batch export.
 */
public final class StatsService implements AutoCloseable {

  private static final JsonMapper JSON = JsonMapper.builder().build();

  private final StatsConfig config;
  private final StatsStore store;
  private final @Nullable StatsTransport transport;
  private final Supplier<CompletableFuture<Boolean>> exportGate;
  private final InstantSource time;
  private final Supplier<UUID> ids;
  private final Logger logger;
  private final SessionLedger ledger;

  private final Map<UUID, StatsWire.PlayerGameplaySnapshot> pendingPlayerSnapshots =
      new ConcurrentHashMap<>();
  private final AtomicReference<StatsWire.@Nullable ServerSnapshot> pendingServerSnapshot =
      new AtomicReference<>();
  private final Object flushLock = new Object();
  private CompletableFuture<Void> inFlight = CompletableFuture.completedFuture(null);
  private volatile boolean stopped;

  public record Dependencies(
      StatsConfig config,
      StatsStore store,
      @Nullable StatsTransport transport,
      Supplier<CompletableFuture<Boolean>> exportGate) {}

  public record Clocks(InstantSource time, Supplier<UUID> ids, Logger logger) {}

  public StatsService(Dependencies dependencies, Clocks clocks) {
    this.config = dependencies.config();
    this.store = dependencies.store();
    this.transport = dependencies.transport();
    this.exportGate = dependencies.exportGate();
    this.time = clocks.time();
    this.ids = clocks.ids();
    this.logger = clocks.logger();
    this.ledger = new SessionLedger(clocks.ids());
  }

  public StatsStore store() {
    return store;
  }

  public StatsConfig config() {
    return config;
  }

  public CompletableFuture<Integer> recoverInterrupted() {
    return store.recoverInterrupted(now(), ids);
  }

  public synchronized void playerJoined(SessionLedger.JoinInput input) {
    if (stopped) {
      return;
    }
    ledger.join(input).ifPresent(this::persistTransition);
  }

  public synchronized void syncState(UUID playerUuid, SessionLedger.StateSample sample) {
    if (stopped) {
      return;
    }
    ledger.update(playerUuid, sample).ifPresent(this::persistTransition);
  }

  public synchronized void syncAfk(UUID playerUuid, boolean afk) {
    if (stopped) {
      return;
    }
    ledger.updateAfk(playerUuid, now(), afk).ifPresent(this::persistTransition);
  }

  public synchronized void checkpointPlayer(UUID playerUuid, SessionLedger.StateSample sample) {
    if (stopped) {
      return;
    }
    ledger.checkpoint(playerUuid, sample).ifPresent(this::persistTransition);
  }

  public synchronized void playerLeft(UUID playerUuid, EndReason reason, @Nullable Integer pingMs) {
    if (stopped) {
      return;
    }
    ledger
        .leave(new SessionLedger.LeaveInput(playerUuid, now(), reason, pingMs))
        .ifPresent(this::persistTransition);
  }

  public synchronized Optional<Instant> sessionStartedAt(UUID playerUuid) {
    return ledger.sessionOf(playerUuid).map(SessionLedger.OpenSessionView::startedAt);
  }

  public synchronized void recordCombat(CombatClassifier.ClassifiedCombat combat) {
    if (stopped) {
      return;
    }
    var at = now();
    var sessionOwner =
        combat.killer() != null
            ? combat.killer().uuid()
            : (combat.victim() != null ? combat.victim().uuid() : null);
    var sessionId =
        sessionOwner == null
            ? null
            : ledger.sessionOf(sessionOwner).map(view -> view.sessionId().toString()).orElse(null);
    var eventId = ids.get();
    var wire =
        new StatsWire.CombatWireEvent(
            "combat_event",
            eventId.toString(),
            at.toString(),
            sessionId,
            combat.kind().wire(),
            combat.killer() == null ? null : combat.killer().uuid().toString(),
            combat.killer() == null ? null : combat.killer().name(),
            combat.victim() == null ? null : combat.victim().uuid().toString(),
            combat.victim() == null ? null : combat.victim().name(),
            combat.mobType(),
            combat.weapon(),
            combat.world().wire());
    var deltas = combatDeltas(combat, at.toEpochMilli());
    observe(
        store.save(
            new StatsWrite(
                deltas, null, null, List.of(new StatsWrite.OutboxDraft.Ready(eventId, at, wire)))),
        "save combat event");
  }

  public record BounceInput(
      @Nullable UUID playerUuid,
      String playerName,
      BounceCategory category,
      String reason,
      @Nullable String joinAddress) {}

  public void recordBounce(BounceInput bounce) {
    if (stopped) {
      return;
    }
    var at = now();
    var eventId = ids.get();
    var wire =
        new StatsWire.ConnectionBounceEvent(
            "connection_bounce",
            eventId.toString(),
            at.toString(),
            bounce.playerUuid() == null ? null : bounce.playerUuid().toString(),
            CombatClassifier.boundName(bounce.playerName()),
            bounce.category().wire(),
            bounce.reason(),
            bounce.joinAddress());
    observe(
        store.save(
            new StatsWrite(
                List.of(),
                null,
                null,
                List.of(new StatsWrite.OutboxDraft.Ready(eventId, at, wire)))),
        "save connection bounce");
  }

  public void bufferSnapshots(
      StatsWire.ServerSnapshot serverSnapshot,
      List<StatsWire.PlayerGameplaySnapshot> playerSnapshots) {
    if (stopped || transport == null) {
      return;
    }
    putServerSnapshot(serverSnapshot);
    for (var snapshot : playerSnapshots) {
      putPlayerSnapshot(snapshot);
    }
  }

  public void bufferPlayerSnapshot(StatsWire.PlayerGameplaySnapshot snapshot) {
    if (stopped || transport == null) {
      return;
    }
    putPlayerSnapshot(snapshot);
  }

  private void putServerSnapshot(StatsWire.ServerSnapshot incoming) {
    while (true) {
      var existing = pendingServerSnapshot.get();
      if (existing != null
          && Instant.parse(incoming.capturedAt()).isBefore(Instant.parse(existing.capturedAt()))) {
        return;
      }
      if (pendingServerSnapshot.compareAndSet(existing, incoming)) {
        return;
      }
    }
  }

  private void putPlayerSnapshot(StatsWire.PlayerGameplaySnapshot snapshot) {
    var playerUuid = UUID.fromString(snapshot.playerUuid());
    pendingPlayerSnapshots.merge(
        playerUuid,
        snapshot,
        (existing, incoming) ->
            Instant.parse(incoming.capturedAt()).isBefore(Instant.parse(existing.capturedAt()))
                ? existing
                : incoming);
    if (pendingPlayerSnapshots.size() > 500) {
      var first = pendingPlayerSnapshots.keySet().iterator();
      if (first.hasNext()) {
        pendingPlayerSnapshots.remove(first.next());
      }
    }
  }

  public CompletableFuture<Void> resetPlayer(UUID playerUuid) {
    synchronized (this) {
      ledger.forget(playerUuid);
    }
    pendingPlayerSnapshots.remove(playerUuid);
    return store.resetPlayer(playerUuid);
  }

  public CompletableFuture<Void> flush() {
    if (stopped || transport == null) {
      return CompletableFuture.completedFuture(null);
    }
    synchronized (flushLock) {
      inFlight =
          inFlight
              .handle((done, failure) -> (Void) null)
              .thenCompose(ignored -> exportGate.get())
              .thenCompose(enabled ->
                  Boolean.TRUE.equals(enabled) && !stopped
                      ? drain(transport)
                      : CompletableFuture.completedFuture(null));
      return inFlight;
    }
  }

  private CompletableFuture<Void> drain(StatsTransport activeTransport) {
    if (stopped) {
      return CompletableFuture.completedFuture(null);
    }
    return store
        .pendingEvents(StatsWire.MAX_EVENTS_PER_BATCH)
        .thenCompose(pending -> sendNextBatch(activeTransport, pending));
  }

  private CompletableFuture<Void> sendNextBatch(
      StatsTransport activeTransport, List<StatsStore.PendingEvent> pending) {
    if (stopped) {
      return CompletableFuture.completedFuture(null);
    }
    var serverSnap = pendingServerSnapshot.getAndSet(null);
    var playerSnaps = takePlayerSnapshots();
    if (pending.isEmpty() && playerSnaps.isEmpty() && serverSnap == null) {
      return CompletableFuture.completedFuture(null);
    }
    var parsedEvents =
        pending.stream().map(event -> (Object) JSON.readTree(event.eventJson())).toList();
    var batch =
        new StatsWire.IngestBatch(
            StatsWire.SCHEMA_VERSION,
            ids.get().toString(),
            config.serverName(),
            now().toString(),
            parsedEvents,
            playerSnaps,
            serverSnap);
    return activeTransport
        .send(batch)
        .handle(
            (done, failure) -> handleBatchOutcome(failure, pending.size(), serverSnap, playerSnaps))
        .thenCompose(sent -> afterBatchSent(activeTransport, pending, sent));
  }

  private boolean handleBatchOutcome(
      @Nullable Throwable failure,
      int eventCount,
      StatsWire.@Nullable ServerSnapshot serverSnap,
      List<StatsWire.PlayerGameplaySnapshot> playerSnaps) {
    if (failure == null) {
      return true;
    }
    restoreSnapshots(serverSnap, playerSnaps);
    if (!stopped) {
      logger.warn(
          "Could not export stats batch ({} events); queued events will retry: {}",
          eventCount,
          failure.getMessage());
    }
    return false;
  }

  private CompletableFuture<Void> afterBatchSent(
      StatsTransport activeTransport, List<StatsStore.PendingEvent> pending, boolean sent) {
    if (!sent || stopped) {
      return CompletableFuture.completedFuture(null);
    }
    var ackIds = pending.stream().map(StatsStore.PendingEvent::eventId).toList();
    var ackFuture =
        ackIds.isEmpty()
            ? CompletableFuture.<Void>completedFuture(null)
            : store.acknowledgeEvents(ackIds);
    boolean hasMore =
        pending.size() == StatsWire.MAX_EVENTS_PER_BATCH || !pendingPlayerSnapshots.isEmpty();
    return hasMore ? ackFuture.thenCompose(ignored -> drain(activeTransport)) : ackFuture;
  }

  private List<StatsWire.PlayerGameplaySnapshot> takePlayerSnapshots() {
    var taken = new ArrayList<StatsWire.PlayerGameplaySnapshot>();
    var iterator = pendingPlayerSnapshots.entrySet().iterator();
    while (iterator.hasNext() && taken.size() < StatsWire.MAX_PLAYER_SNAPSHOTS_PER_BATCH) {
      var entry = iterator.next();
      if (pendingPlayerSnapshots.remove(entry.getKey(), entry.getValue())) {
        taken.add(entry.getValue());
      }
    }
    return List.copyOf(taken);
  }

  private void restoreSnapshots(
      StatsWire.@Nullable ServerSnapshot serverSnap,
      List<StatsWire.PlayerGameplaySnapshot> playerSnaps) {
    if (serverSnap != null) {
      putServerSnapshot(serverSnap);
    }
    for (var snap : playerSnaps) {
      putPlayerSnapshot(snap);
    }
  }

  private void persistTransition(SessionLedger.LedgerTransition transition) {
    var delta =
        new StatsWrite.PlayerDelta(
            transition.playerUuid(),
            transition.playerName(),
            transition.seenAt().toEpochMilli(),
            transition.connectedMsDelta(),
            transition.activeMsDelta(),
            transition.sessionsDelta(),
            0,
            0,
            0);
    var openRow =
        transition.openSession() == null
            ? null
            : StatsWrite.OpenSessionRow.fromView(transition.openSession());
    var drafts = transition.events().stream().map(StatsService::toDraft).toList();
    observe(
        store.save(new StatsWrite(List.of(delta), openRow, transition.closedSessionId(), drafts)),
        "save session transition");
  }

  private static StatsWrite.OutboxDraft toDraft(SessionLedger.LedgerEvent event) {
    return switch (event) {
      case SessionLedger.LedgerEvent.Started started ->
          new StatsWrite.OutboxDraft.SessionStartNeedsFirstSeen(
              started.eventId(),
              started.occurredAt(),
              started.sessionId(),
              started.playerUuid(),
              started.playerName(),
              started.platform().wire(),
              started.clientVersion(),
              started.clientBrand(),
              started.joinAddress(),
              started.countryCode(),
              started.countryName());
      case SessionLedger.LedgerEvent.Interval interval ->
          new StatsWrite.OutboxDraft.Ready(
              interval.eventId(),
              interval.occurredAt(),
              new StatsWire.SessionIntervalEvent(
                  "session_interval",
                  interval.eventId().toString(),
                  interval.occurredAt().toString(),
                  interval.intervalEnd().toString(),
                  interval.sessionId().toString(),
                  interval.playerUuid().toString(),
                  interval.playerName(),
                  interval.world().wire(),
                  interval.mode().wire(),
                  interval.connectedMs(),
                  interval.activeMs(),
                  interval.pingMs()));
      case SessionLedger.LedgerEvent.Ended ended ->
          new StatsWrite.OutboxDraft.Ready(
              ended.eventId(),
              ended.occurredAt(),
              new StatsWire.SessionEndedEvent(
                  "session_ended",
                  ended.eventId().toString(),
                  ended.occurredAt().toString(),
                  ended.sessionId().toString(),
                  ended.playerUuid().toString(),
                  ended.playerName(),
                  ended.startedAt().toString(),
                  ended.connectedMs(),
                  ended.activeMs(),
                  ended.endReason().wire(),
                  ended.pingMinMs(),
                  ended.pingAvgMs(),
                  ended.pingMaxMs()));
    };
  }

  private static List<StatsWrite.PlayerDelta> combatDeltas(
      CombatClassifier.ClassifiedCombat combat, long seenAtMs) {
    var deltas = new ArrayList<StatsWrite.PlayerDelta>(2);
    if (combat.kind() == CombatKind.PVP) {
      if (combat.killer() != null) {
        deltas.add(
            new StatsWrite.PlayerDelta(
                combat.killer().uuid(), combat.killer().name(), seenAtMs, 0, 0, 0, 1, 0, 0));
      }
      if (combat.victim() != null) {
        deltas.add(
            new StatsWrite.PlayerDelta(
                combat.victim().uuid(), combat.victim().name(), seenAtMs, 0, 0, 0, 0, 1, 0));
      }
    } else if (combat.kind() == CombatKind.PVE_KILL && combat.killer() != null) {
      deltas.add(
          new StatsWrite.PlayerDelta(
              combat.killer().uuid(), combat.killer().name(), seenAtMs, 0, 0, 0, 0, 0, 1));
    }
    return List.copyOf(deltas);
  }

  @Override
  public void close() {
    List<SessionLedger.LedgerTransition> closing;
    synchronized (this) {
      if (stopped) {
        return;
      }
      stopped = true;
      closing = ledger.shutdown(now());
    }
    for (var transition : closing) {
      persistTransition(transition);
    }
    if (transport != null) {
      transport.close();
    }
  }

  private Instant now() {
    return Instant.ofEpochMilli(time.instant().toEpochMilli());
  }

  private void observe(CompletableFuture<?> future, String action) {
    var _ =
        future.whenComplete((done, failure) -> {
          if (failure != null) {
            logger.error("Stats module could not {}", action, failure);
          }
        });
  }
}
