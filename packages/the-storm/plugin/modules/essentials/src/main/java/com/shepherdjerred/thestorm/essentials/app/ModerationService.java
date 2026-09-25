package com.shepherdjerred.thestorm.essentials.app;

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
 * Kicks and bans. Every action is appended to the audit log; each player's standing is replayed
 * from the log into memory when the module starts and kept current on every write, so the login
 * check never touches the database.
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

  /** Starts replaying every standing from {@code log}; see {@link #loaded()}. */
  public static ModerationService load(ModerationLogStore log, InstantSource time) {
    return new ModerationService(log, time);
  }

  /** Completes once the audit log has been replayed. */
  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  /**
   * Records {@code entry} once the log has loaded. The in-memory standing changes before the write,
   * so a ban applies to the next login at once.
   */
  public CompletableFuture<Void> record(AuditEntry entry) {
    return loaded.thenCompose(
        ready -> {
          apply(entry);
          return log.append(entry);
        });
  }

  /** The ban in force on {@code player} once the log has loaded. For the login check. */
  public CompletableFuture<Optional<Ban>> activeBan(UUID player) {
    return loaded.thenApply(
        ready -> standings.getOrDefault(player, Standing.CLEAN).activeBan(time.instant()));
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
