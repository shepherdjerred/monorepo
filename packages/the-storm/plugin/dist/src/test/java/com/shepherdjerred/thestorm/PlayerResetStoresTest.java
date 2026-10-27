package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class PlayerResetStoresTest {

  @Test
  void everyDirectStoreResetExecutesAgainstTheShippedSchema(@TempDir Path directory)
      throws Exception {
    try (var database = StormDatabase.open(directory.resolve("reset.db"))) {
      for (var module :
          List.of(
              "core",
              "economy",
              "safety",
              "chat",
              "mail",
              "tracks",
              "towns",
              "creative",
              "discord",
              "essentials",
              "tickets",
              "agent",
              "shops",
              "spells",
              "mobs",
              "npcs",
              "quests",
              "arena",
              "rwf",
              "skills",
              "world",
              "qol")) {
        database.migrate(module, getClass().getClassLoader());
      }
      var player = UUID.randomUUID();
      await(
          new com.shepherdjerred.thestorm.agent.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.arena.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.chat.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.creative.adapter.db.JooqPlayerReset(database)
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.economy.adapter.db.JooqLedgerStore(
                  database, InstantSource.system(), TransferRules.standard())
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.essentials.adapter.db.JooqPlayerReset(database)
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.mail.adapter.db.JooqPlayerReset(database).reset(player));
      await(new com.shepherdjerred.thestorm.qol.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.quests.adapter.db.JooqQuestStore(database).reset(player));
      await(new com.shepherdjerred.thestorm.rwf.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.shops.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.spells.adapter.db.JooqSpellStore(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.tickets.adapter.db.JooqPlayerReset(database)
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.towns.adapter.db.JooqPlayerReset(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.safety.adapter.db.JooqEvidenceStore(database)
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.world.adapter.db.JooqDailyLedger(database).reset(player));
      await(
          new com.shepherdjerred.thestorm.skills.adapter.db.JooqSkillLevels(database)
              .reset(player));
      await(
          new com.shepherdjerred.thestorm.discord.adapter.db.JooqLinkStore(database)
              .unlinkPlayer(player));
      await(
          new com.shepherdjerred.thestorm.core.players.SqlPlayerDirectory(database).reset(player));

      int directoryRows =
          await(database.read(dsl -> dsl.fetchCount(org.jooq.impl.DSL.table("core_player"))));
      assertThat(directoryRows).isZero();
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
