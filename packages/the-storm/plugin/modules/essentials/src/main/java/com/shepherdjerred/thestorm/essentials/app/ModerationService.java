package com.shepherdjerred.thestorm.essentials.app;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.essentials.app.store.ModerationLogStore;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Ban;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Standing;
import java.time.InstantSource;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Kicks and bans. Every action is appended to the audit log first; only once the append succeeds
 * does the in-memory standing change, so memory never claims a ban the log lost. Standings are
 * replayed from the log when the module starts, so the login check never touches the database.
 */
public final class ModerationService {

  private final ModerationLogStore log;
  private final InstantSource time;
  private final Map<UUID, Standing> standings = new ConcurrentHashMap<>();
  private final CompletableFuture<Void> loaded;

  private ModerationService(ModerationLogStore log, InstantSource time) {
    this.log = log;
    this.time = time;
    this.loaded = log.all().thenAccept(entries -> entries.forEach(this::apply));
  }

  /**
   * A ban in force.
   *
   * @param player the banned player
   * @param ban the ban
   */
  public record ActiveBan(UUID player, Ban ban) {}

  /** Starts replaying every standing from {@code log}; see {@link #loaded()}. */
  public static ModerationService load(ModerationLogStore log, InstantSource time) {
    return new ModerationService(log, time);
  }

  /** Completes once the audit log has been replayed. */
  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  /**
   * Appends {@code entry} to the log once it has loaded, then applies it in memory. Fails if the
   * append fails, and then nothing changes.
   */
  public CompletableFuture<Void> record(AuditEntry entry) {
    return loaded.thenCompose(ready -> log.append(entry)).thenRun(() -> apply(entry));
  }

  /** The ban in force on {@code player} once the log has loaded. For the login check. */
  public CompletableFuture<Optional<Ban>> activeBan(UUID player) {
    return loaded.thenApply(
        ready -> standings.getOrDefault(player, Standing.CLEAN).activeBan(time.instant()));
  }

  /** Every ban in force once the log has loaded, newest first. For {@code /banlist}. */
  public CompletableFuture<List<ActiveBan>> activeBans() {
    return loaded.thenApply(
        ready -> {
          var now = time.instant();
          return standings.entrySet().stream()
              .flatMap(
                  entry ->
                      entry.getValue().activeBan(now).stream()
                          .map(ban -> new ActiveBan(entry.getKey(), ban)))
              .sorted(comparing((ActiveBan active) -> active.ban().at()).reversed())
              .toList();
        });
  }

  /** {@code player}'s newest {@code limit} audit entries, newest first. */
  public CompletableFuture<List<AuditEntry>> history(UUID player, int limit) {
    return log.history(player, limit);
  }

  private void apply(AuditEntry entry) {
    standings.compute(
        entry.target(), (id, old) -> (old == null ? Standing.CLEAN : old).apply(entry));
  }
}
