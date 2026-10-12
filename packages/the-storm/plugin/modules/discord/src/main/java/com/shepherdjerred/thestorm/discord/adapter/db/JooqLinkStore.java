package com.shepherdjerred.thestorm.discord.adapter.db;

import static com.shepherdjerred.thestorm.discord.adapter.db.generated.Tables.DISCORD_LINK;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.discord.app.LinkStore;
import com.shepherdjerred.thestorm.discord.app.Links;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link LinkStore} in SQLite. */
public final class JooqLinkStore implements LinkStore {

  private final StormDatabase database;

  public JooqLinkStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<Links.Link>> all() {
    return database.read(
        dsl ->
            dsl.selectFrom(DISCORD_LINK).fetch().stream()
                .map(
                    row ->
                        new Links.Link(
                            UUID.fromString(row.getPlayer()),
                            Long.parseLong(row.getDiscordUser()),
                            row.getDms()))
                .toList());
  }

  @Override
  public CompletableFuture<Void> link(Links.Link link, Instant at) {
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(DISCORD_LINK)
                  .where(DISCORD_LINK.PLAYER.eq(link.player().toString()))
                  .or(DISCORD_LINK.DISCORD_USER.eq(Long.toString(link.discordUser())))
                  .execute();
              return dsl.insertInto(DISCORD_LINK)
                  .set(DISCORD_LINK.PLAYER, link.player().toString())
                  .set(DISCORD_LINK.DISCORD_USER, Long.toString(link.discordUser()))
                  .set(DISCORD_LINK.DMS, link.dms())
                  .set(DISCORD_LINK.LINKED_MS, at.toEpochMilli())
                  .execute();
            })
        .thenAccept(inserted -> {});
  }

  @Override
  public CompletableFuture<Boolean> unlinkPlayer(UUID player) {
    return database.write(
        dsl ->
            dsl.deleteFrom(DISCORD_LINK).where(DISCORD_LINK.PLAYER.eq(player.toString())).execute()
                > 0);
  }

  @Override
  public CompletableFuture<Boolean> unlinkDiscord(long discordUser) {
    return database.write(
        dsl ->
            dsl.deleteFrom(DISCORD_LINK)
                    .where(DISCORD_LINK.DISCORD_USER.eq(Long.toString(discordUser)))
                    .execute()
                > 0);
  }

  @Override
  public CompletableFuture<Boolean> setDms(UUID player, boolean on) {
    return database.write(
        dsl ->
            dsl.update(DISCORD_LINK)
                    .set(DISCORD_LINK.DMS, on)
                    .where(DISCORD_LINK.PLAYER.eq(player.toString()))
                    .execute()
                > 0);
  }
}
