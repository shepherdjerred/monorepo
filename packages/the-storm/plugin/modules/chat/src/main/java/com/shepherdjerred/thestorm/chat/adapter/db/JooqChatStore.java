package com.shepherdjerred.thestorm.chat.adapter.db;

import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_FOCUS;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_HIDDEN_CHANNEL;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_IGNORE;
import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_MUTE;

import com.shepherdjerred.thestorm.chat.app.ChatSnapshot;
import com.shepherdjerred.thestorm.chat.app.ChatStore;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.jooq.DSLContext;

/** {@link ChatStore} over the chat tables in the shared SQLite database. */
public final class JooqChatStore implements ChatStore {

  private final StormDatabase database;
  private final Consumer<Throwable> failures;

  /**
   * @param failures told about every failed write
   */
  public JooqChatStore(StormDatabase database, Consumer<Throwable> failures) {
    this.database = database;
    this.failures = failures;
  }

  @Override
  public CompletableFuture<ChatSnapshot> loadAll(Instant now, ChannelKey defaultFocus) {
    return database.write(
        dsl -> {
          dsl.deleteFrom(CHAT_MUTE).where(CHAT_MUTE.UNTIL_MS.le(now.toEpochMilli())).execute();
          return new ChatSnapshot(loadProfiles(dsl, defaultFocus), loadMutes(dsl));
        });
  }

  @Override
  public void saveProfile(UUID player, ChatProfile profile) {
    report(writeProfile(player, profile));
  }

  @Override
  public void saveMute(UUID player, Mute mute) {
    report(writeMute(player, mute));
  }

  @Override
  public void deleteMute(UUID player) {
    report(removeMute(player));
  }

  /** {@link #saveProfile}, returning the write for callers that wait on it. */
  public CompletableFuture<Integer> writeProfile(UUID player, ChatProfile profile) {
    var id = player.toString();
    return database.write(
        dsl -> {
          dsl.deleteFrom(CHAT_FOCUS).where(CHAT_FOCUS.PLAYER.eq(id)).execute();
          dsl.deleteFrom(CHAT_HIDDEN_CHANNEL).where(CHAT_HIDDEN_CHANNEL.PLAYER.eq(id)).execute();
          dsl.deleteFrom(CHAT_IGNORE).where(CHAT_IGNORE.PLAYER.eq(id)).execute();
          var rows =
              dsl.insertInto(CHAT_FOCUS)
                  .set(CHAT_FOCUS.PLAYER, id)
                  .set(CHAT_FOCUS.CHANNEL, profile.focus().id())
                  .execute();
          for (var channel : profile.hidden()) {
            rows +=
                dsl.insertInto(CHAT_HIDDEN_CHANNEL)
                    .set(CHAT_HIDDEN_CHANNEL.PLAYER, id)
                    .set(CHAT_HIDDEN_CHANNEL.CHANNEL, channel.id())
                    .execute();
          }
          for (var ignored : profile.ignored().entrySet()) {
            rows +=
                dsl.insertInto(CHAT_IGNORE)
                    .set(CHAT_IGNORE.PLAYER, id)
                    .set(CHAT_IGNORE.IGNORED, ignored.getKey().toString())
                    .set(CHAT_IGNORE.IGNORED_NAME, ignored.getValue())
                    .execute();
          }
          return rows;
        });
  }

  /** {@link #saveMute}, returning the write for callers that wait on it. */
  public CompletableFuture<Integer> writeMute(UUID player, Mute mute) {
    return database.write(
        dsl -> {
          return dsl.insertInto(CHAT_MUTE)
              .set(CHAT_MUTE.PLAYER, player.toString())
              .set(CHAT_MUTE.UNTIL_MS, mute.until().toEpochMilli())
              .set(CHAT_MUTE.REASON, mute.reason())
              .set(CHAT_MUTE.ISSUER, mute.issuer())
              .onConflict(CHAT_MUTE.PLAYER)
              .doUpdate()
              .set(CHAT_MUTE.UNTIL_MS, mute.until().toEpochMilli())
              .set(CHAT_MUTE.REASON, mute.reason())
              .set(CHAT_MUTE.ISSUER, mute.issuer())
              .execute();
        });
  }

  /** {@link #deleteMute}, returning the write for callers that wait on it. */
  public CompletableFuture<Integer> removeMute(UUID player) {
    return database.write(
        dsl -> {
          return dsl.deleteFrom(CHAT_MUTE).where(CHAT_MUTE.PLAYER.eq(player.toString())).execute();
        });
  }

  private void report(CompletableFuture<Integer> write) {
    // Fire and forget: the in-memory state is authoritative; a failure is only reported.
    var _ =
        write.whenComplete(
            (ignored, error) -> {
              if (error != null) {
                failures.accept(error);
              }
            });
  }

  private static Map<UUID, ChatProfile> loadProfiles(DSLContext dsl, ChannelKey defaultFocus) {
    var focus = new HashMap<UUID, ChannelKey>();
    dsl.selectFrom(CHAT_FOCUS)
        .forEach(row -> focus.put(UUID.fromString(row.getPlayer()), channel(row.getChannel())));
    var hidden = new HashMap<UUID, Set<ChannelKey>>();
    dsl.selectFrom(CHAT_HIDDEN_CHANNEL)
        .forEach(
            row ->
                hidden
                    .computeIfAbsent(
                        UUID.fromString(row.getPlayer()), id -> EnumSet.noneOf(ChannelKey.class))
                    .add(channel(row.getChannel())));
    var ignored = new HashMap<UUID, Map<UUID, String>>();
    dsl.selectFrom(CHAT_IGNORE)
        .forEach(
            row ->
                ignored
                    .computeIfAbsent(UUID.fromString(row.getPlayer()), id -> new HashMap<>())
                    .put(UUID.fromString(row.getIgnored()), row.getIgnoredName()));
    var players = new HashSet<UUID>(focus.keySet());
    players.addAll(hidden.keySet());
    players.addAll(ignored.keySet());
    var profiles = new HashMap<UUID, ChatProfile>();
    for (var player : players) {
      profiles.put(
          player,
          new ChatProfile(
              focus.getOrDefault(player, defaultFocus),
              hidden.getOrDefault(player, Set.of()),
              ignored.getOrDefault(player, Map.of())));
    }
    return profiles;
  }

  private static Map<UUID, Mute> loadMutes(DSLContext dsl) {
    var mutes = new HashMap<UUID, Mute>();
    dsl.selectFrom(CHAT_MUTE)
        .forEach(
            row ->
                mutes.put(
                    UUID.fromString(row.getPlayer()),
                    new Mute(
                        Instant.ofEpochMilli(row.getUntilMs()), row.getReason(), row.getIssuer())));
    return mutes;
  }

  private static ChannelKey channel(String id) {
    return ChannelKey.fromId(id)
        .orElseThrow(() -> new IllegalStateException("unknown chat channel in storage: " + id));
  }
}
