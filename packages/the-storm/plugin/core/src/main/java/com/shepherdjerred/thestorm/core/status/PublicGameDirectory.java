package com.shepherdjerred.thestorm.core.status;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Immutable, thread-safe public snapshots of human games for the server status query. */
public final class PublicGameDirectory {
  public enum Kind {
    ARENA,
    RWF
  }

  public enum Phase {
    WAITING,
    STARTING,
    RUNNING
  }

  public record Game(
      String id, Kind kind, String name, Phase phase, String progress, List<UUID> players) {
    public Game {
      Objects.requireNonNull(id);
      Objects.requireNonNull(kind);
      Objects.requireNonNull(name);
      Objects.requireNonNull(phase);
      Objects.requireNonNull(progress);
      players = List.copyOf(players);
      if (id.isBlank()
          || id.length() > 64
          || name.isBlank()
          || name.length() > 64
          || players.isEmpty()) {
        throw new IllegalArgumentException("Invalid public game summary");
      }
      if (progress.length() > 32) {
        throw new IllegalArgumentException("Invalid public game progress");
      }
      if (new HashSet<>(players).size() != players.size()) {
        throw new IllegalArgumentException("Duplicate public game participant");
      }
    }
  }

  private final Map<Kind, List<Game>> byKind = new EnumMap<>(Kind.class);
  private volatile List<Game> snapshot = List.of();

  /** Replaces one module's complete game snapshot. Call from its game thread. */
  public synchronized void replace(Kind kind, List<Game> games) {
    Objects.requireNonNull(kind);
    var update = List.copyOf(games);
    if (update.stream().anyMatch(game -> game.kind() != kind)) {
      throw new IllegalArgumentException("Public game kind differs from its publisher");
    }
    if (update.stream().map(Game::id).distinct().count() != update.size()) {
      throw new IllegalArgumentException("Duplicate public game id");
    }
    byKind.put(kind, update);
    var combined = new ArrayList<Game>();
    byKind.values().forEach(combined::addAll);
    combined.sort(Comparator.comparing(Game::kind).thenComparing(Game::id));
    snapshot = List.copyOf(combined);
  }

  /** Safe from Query's network thread; the returned records and lists are immutable. */
  public List<Game> snapshot() {
    return snapshot;
  }
}
