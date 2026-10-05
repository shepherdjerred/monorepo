package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import tools.jackson.databind.json.JsonMapper;

/** Committed staff settings, moderation state and last logout positions. */
public final class StaffState {
  public record Jail(
      String name, Position destination, Position returning, Instant expires, boolean active) {
    public Jail {
      if (!name.matches("[a-z0-9_-]{1,32}"))
        throw new IllegalArgumentException("Invalid jail name");
      java.util.Objects.requireNonNull(destination);
      java.util.Objects.requireNonNull(returning);
      java.util.Objects.requireNonNull(expires);
    }
  }

  public record Session(
      String name, Position position, Instant seen, long playMillis, boolean vanished) {
    public Session {
      if (name.isBlank() || playMillis < 0) throw new IllegalArgumentException("Invalid session");
      java.util.Objects.requireNonNull(position);
      java.util.Objects.requireNonNull(seen);
    }
  }

  public record IpBan(Instant expires, String reason, boolean active) {
    public IpBan {
      java.util.Objects.requireNonNull(expires);
      if (reason.isBlank()) throw new IllegalArgumentException("Ban reason is required");
    }
  }

  private final StaffStore store;
  private final Map<String, Map<String, String>> values = new ConcurrentHashMap<>();
  private final JsonMapper mapper =
      JsonMapper.builder()
          .enable(
              tools.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              tools.jackson.databind.DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              tools.jackson.databind.DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES,
              tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();
  private final CompletableFuture<Void> loaded;
  private volatile boolean ready;

  public StaffState(StaffStore store) {
    this.store = store;
    loaded =
        store
            .load()
            .thenAccept(
                entries -> {
                  entries.forEach(this::apply);
                  ready = true;
                });
  }

  public boolean ready() {
    return ready;
  }

  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  public <T> Optional<T> find(String kind, String key, Class<T> type) {
    if (!ready) throw new IllegalStateException("Staff state is loading");
    return Optional.ofNullable(values.getOrDefault(kind, Map.of()).get(key))
        .map(value -> mapper.readValue(value, type));
  }

  public List<String> keys(String kind) {
    return values.getOrDefault(kind, Map.of()).keySet().stream().sorted().toList();
  }

  public StaffStore.Entry entry(String kind, String key, Object value) {
    return new StaffStore.Entry(kind, key, mapper.writeValueAsString(value));
  }

  public CompletableFuture<Void> commit(List<StaffStore.Entry> entries, StaffStore.Audit audit) {
    entries.forEach(this::validate);
    return loaded
        .thenCompose(_ -> store.write(entries, audit))
        .thenRun(() -> entries.forEach(this::apply));
  }

  private void apply(StaffStore.Entry entry) {
    validate(entry);
    values
        .computeIfAbsent(entry.kind(), _ -> new ConcurrentHashMap<>())
        .put(entry.id(), entry.value());
  }

  private void validate(StaffStore.Entry entry) {
    var type =
        switch (entry.kind()) {
          case "spawn", "rtp", "jail-place" -> Position.class;
          case "jail" -> Jail.class;
          case "session" -> Session.class;
          case "ip-ban" -> IpBan.class;
          case "jail-deleted" -> Boolean.class;
          default -> throw new IllegalStateException("Unknown staff state kind: " + entry.kind());
        };
    var _ = mapper.readValue(entry.value(), type);
  }
}
