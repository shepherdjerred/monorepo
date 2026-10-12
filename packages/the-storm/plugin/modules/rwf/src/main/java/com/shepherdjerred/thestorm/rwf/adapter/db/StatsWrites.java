// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameStatsManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_EVENT;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_PLAYER;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_KIT_STATS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_PREFS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_STATS;

import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import org.jooq.DSLContext;

/**
 * Writes how a match was played, inside the transaction that records the match: its details, each
 * human's line, the event log, their lifetime and per-kit totals as Red Warfare's {@code
 * GameStatsManager} kept them, and the kit each last played.
 */
final class StatsWrites {

  private StatsWrites() {}

  static void write(DSLContext dsl, MatchStore.MatchRow match, MatchStats stats) {
    var id = match.matchId().toString();
    var details = stats.details();
    dsl.update(RWF_MATCH)
        .set(RWF_MATCH.SEED, details.seed())
        .set(RWF_MATCH.DURATION_MS, details.duration().toMillis())
        .set(RWF_MATCH.END_REASON, details.endReason())
        .set(RWF_MATCH.BALLOT, details.ballot().orElse(null))
        .set(RWF_MATCH.MAP_HASH, details.mapHash())
        .where(RWF_MATCH.ID.eq(id))
        .execute();
    for (var line : stats.players()) {
      dsl.update(RWF_MATCH_PLAYER)
          .set(RWF_MATCH_PLAYER.ASSISTS, line.assists())
          .set(RWF_MATCH_PLAYER.DAMAGE_DEALT, line.damageDealt())
          .set(RWF_MATCH_PLAYER.DAMAGE_TAKEN, line.damageTaken())
          .set(RWF_MATCH_PLAYER.ARMS, line.arms())
          .set(RWF_MATCH_PLAYER.DEFUSES, line.defuses())
          .set(RWF_MATCH_PLAYER.EXPLOSIONS, line.explosions())
          .set(RWF_MATCH_PLAYER.STREAKS_EARNED, line.streak())
          .set(RWF_MATCH_PLAYER.ABILITY_USES, line.abilityUses())
          .set(RWF_MATCH_PLAYER.SHOTS_FIRED, line.shotsFired())
          .set(RWF_MATCH_PLAYER.SHOTS_HIT, line.shotsHit())
          .set(RWF_MATCH_PLAYER.STEAKS, line.steaks())
          .set(RWF_MATCH_PLAYER.TIME_ALIVE_MS, line.timeAlive().toMillis())
          .set(RWF_MATCH_PLAYER.DISTANCE, line.distance())
          .set(RWF_MATCH_PLAYER.KIT_SWITCHES, line.kitSwitches())
          .where(RWF_MATCH_PLAYER.MATCH_ID.eq(id))
          .and(RWF_MATCH_PLAYER.PLAYER.eq(line.player().toString()))
          .execute();
      lifetime(dsl, line);
      kit(dsl, line);
      lastKit(dsl, line);
    }
    for (var event : stats.events()) {
      dsl.insertInto(RWF_MATCH_EVENT)
          .set(RWF_MATCH_EVENT.MATCH_ID, id)
          .set(RWF_MATCH_EVENT.SEQ, event.seq())
          .set(RWF_MATCH_EVENT.AT, event.at().toEpochMilli())
          .set(RWF_MATCH_EVENT.KIND, event.kind())
          .set(RWF_MATCH_EVENT.ACTOR, event.actor().map(Object::toString).orElse(null))
          .set(RWF_MATCH_EVENT.TARGET, event.target().orElse(null))
          .set(RWF_MATCH_EVENT.KIT, event.kit().orElse(null))
          .set(RWF_MATCH_EVENT.CAUSE, event.cause().orElse(null))
          .set(RWF_MATCH_EVENT.X, event.x().isPresent() ? event.x().getAsDouble() : null)
          .set(RWF_MATCH_EVENT.Y, event.y().isPresent() ? event.y().getAsDouble() : null)
          .set(RWF_MATCH_EVENT.Z, event.z().isPresent() ? event.z().getAsDouble() : null)
          .set(RWF_MATCH_EVENT.DATA, event.data())
          .execute();
    }
  }

  private static int won(MatchStats.PlayerLine line) {
    return line.result() == MatchStats.Result.WIN ? 1 : 0;
  }

  private static int lost(MatchStats.PlayerLine line) {
    return line.result() == MatchStats.Result.LOSS ? 1 : 0;
  }

  private static void lifetime(DSLContext dsl, MatchStats.PlayerLine line) {
    var player = line.player().toString();
    var row = dsl.selectFrom(RWF_PLAYER_STATS).where(RWF_PLAYER_STATS.PLAYER.eq(player)).fetchOne();
    var suicides = line.suicide() ? 1 : 0;
    if (row == null) {
      var streak = won(line);
      dsl.insertInto(RWF_PLAYER_STATS)
          .set(RWF_PLAYER_STATS.PLAYER, player)
          .set(RWF_PLAYER_STATS.NAME, line.name())
          .set(RWF_PLAYER_STATS.MATCHES, 1)
          .set(RWF_PLAYER_STATS.KILLS, line.kills())
          .set(RWF_PLAYER_STATS.ASSISTS, line.assists())
          .set(RWF_PLAYER_STATS.DEATHS, line.deaths())
          .set(RWF_PLAYER_STATS.SUICIDES, suicides)
          .set(RWF_PLAYER_STATS.WINS, won(line))
          .set(RWF_PLAYER_STATS.LOSSES, lost(line))
          .set(RWF_PLAYER_STATS.WIN_STREAK, streak)
          .set(RWF_PLAYER_STATS.BEST_WIN_STREAK, streak)
          .set(RWF_PLAYER_STATS.BEST_STREAK, line.streak())
          .set(RWF_PLAYER_STATS.TIME_MS, line.timeAlive().toMillis())
          .set(RWF_PLAYER_STATS.STEAKS, line.steaks())
          .execute();
      return;
    }
    var streak =
        switch (line.result()) {
          case WIN -> row.getWinStreak() + 1;
          case LOSS -> 0;
          case NONE -> row.getWinStreak();
        };
    dsl.update(RWF_PLAYER_STATS)
        .set(RWF_PLAYER_STATS.NAME, line.name())
        .set(RWF_PLAYER_STATS.MATCHES, row.getMatches() + 1)
        .set(RWF_PLAYER_STATS.KILLS, row.getKills() + line.kills())
        .set(RWF_PLAYER_STATS.ASSISTS, row.getAssists() + line.assists())
        .set(RWF_PLAYER_STATS.DEATHS, row.getDeaths() + line.deaths())
        .set(RWF_PLAYER_STATS.SUICIDES, row.getSuicides() + suicides)
        .set(RWF_PLAYER_STATS.WINS, row.getWins() + won(line))
        .set(RWF_PLAYER_STATS.LOSSES, row.getLosses() + lost(line))
        .set(RWF_PLAYER_STATS.WIN_STREAK, streak)
        .set(RWF_PLAYER_STATS.BEST_WIN_STREAK, Math.max(row.getBestWinStreak(), streak))
        .set(RWF_PLAYER_STATS.BEST_STREAK, Math.max(row.getBestStreak(), line.streak()))
        .set(RWF_PLAYER_STATS.TIME_MS, row.getTimeMs() + line.timeAlive().toMillis())
        .set(RWF_PLAYER_STATS.STEAKS, row.getSteaks() + line.steaks())
        .where(RWF_PLAYER_STATS.PLAYER.eq(player))
        .execute();
  }

  private static void kit(DSLContext dsl, MatchStats.PlayerLine line) {
    var player = line.player().toString();
    var row =
        dsl.selectFrom(RWF_PLAYER_KIT_STATS)
            .where(RWF_PLAYER_KIT_STATS.PLAYER.eq(player))
            .and(RWF_PLAYER_KIT_STATS.KIT.eq(line.kit()))
            .fetchOne();
    var suicides = line.suicide() ? 1 : 0;
    if (row == null) {
      dsl.insertInto(RWF_PLAYER_KIT_STATS)
          .set(RWF_PLAYER_KIT_STATS.PLAYER, player)
          .set(RWF_PLAYER_KIT_STATS.KIT, line.kit())
          .set(RWF_PLAYER_KIT_STATS.MATCHES, 1)
          .set(RWF_PLAYER_KIT_STATS.KILLS, line.kills())
          .set(RWF_PLAYER_KIT_STATS.ASSISTS, line.assists())
          .set(RWF_PLAYER_KIT_STATS.DEATHS, line.deaths())
          .set(RWF_PLAYER_KIT_STATS.SUICIDES, suicides)
          .set(RWF_PLAYER_KIT_STATS.WINS, won(line))
          .set(RWF_PLAYER_KIT_STATS.LOSSES, lost(line))
          .set(RWF_PLAYER_KIT_STATS.BEST_STREAK, line.streak())
          .set(RWF_PLAYER_KIT_STATS.TIME_MS, line.timeAlive().toMillis())
          .set(RWF_PLAYER_KIT_STATS.STEAKS, line.steaks())
          .execute();
      return;
    }
    dsl.update(RWF_PLAYER_KIT_STATS)
        .set(RWF_PLAYER_KIT_STATS.MATCHES, row.getMatches() + 1)
        .set(RWF_PLAYER_KIT_STATS.KILLS, row.getKills() + line.kills())
        .set(RWF_PLAYER_KIT_STATS.ASSISTS, row.getAssists() + line.assists())
        .set(RWF_PLAYER_KIT_STATS.DEATHS, row.getDeaths() + line.deaths())
        .set(RWF_PLAYER_KIT_STATS.SUICIDES, row.getSuicides() + suicides)
        .set(RWF_PLAYER_KIT_STATS.WINS, row.getWins() + won(line))
        .set(RWF_PLAYER_KIT_STATS.LOSSES, row.getLosses() + lost(line))
        .set(RWF_PLAYER_KIT_STATS.BEST_STREAK, Math.max(row.getBestStreak(), line.streak()))
        .set(RWF_PLAYER_KIT_STATS.TIME_MS, row.getTimeMs() + line.timeAlive().toMillis())
        .set(RWF_PLAYER_KIT_STATS.STEAKS, row.getSteaks() + line.steaks())
        .where(RWF_PLAYER_KIT_STATS.PLAYER.eq(player))
        .and(RWF_PLAYER_KIT_STATS.KIT.eq(line.kit()))
        .execute();
  }

  private static void lastKit(DSLContext dsl, MatchStats.PlayerLine line) {
    var player = line.player().toString();
    var updated =
        dsl.update(RWF_PLAYER_PREFS)
            .set(RWF_PLAYER_PREFS.LAST_KIT, line.kit())
            .where(RWF_PLAYER_PREFS.PLAYER.eq(player))
            .execute();
    if (updated == 0) {
      dsl.insertInto(RWF_PLAYER_PREFS)
          .set(RWF_PLAYER_PREFS.PLAYER, player)
          .set(RWF_PLAYER_PREFS.LAST_KIT, line.kit())
          .set(RWF_PLAYER_PREFS.TEAM_CHAT, true)
          .set(RWF_PLAYER_PREFS.KIT_LAYOUTS, "{}")
          .execute();
    }
  }
}
