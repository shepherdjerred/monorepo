package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_DAILY_EARNINGS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_PLAYER;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfMatchPlayerRecord;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/**
 * {@link MatchStore} over {@code rwf_match}, {@code rwf_match_player} and, for legacy crystal rows
 * only, {@code rwf_daily_earnings}.
 */
public final class JooqMatchStore implements MatchStore {

  private final StormDatabase database;

  public JooqMatchStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> record(
      MatchRow match, List<PlayerRow> players, Optional<MatchStats> stats) {
    for (var player : players) {
      if (!player.matchId().equals(match.matchId())) {
        throw new IllegalArgumentException(player.player() + " belongs to another match");
      }
    }
    return Writes.done(
        database.write(
            dsl -> {
              dsl.insertInto(RWF_MATCH)
                  .set(RWF_MATCH.ID, match.matchId().toString())
                  .set(RWF_MATCH.MAP, match.mapId())
                  .set(RWF_MATCH.STARTED_AT, match.startedAt().toEpochMilli())
                  .set(RWF_MATCH.ENDED_AT, match.endedAt().toEpochMilli())
                  .set(RWF_MATCH.WINNER, match.winner().map(TeamColor::name).orElse(null))
                  .set(RWF_MATCH.HUMANS, match.humans())
                  .set(RWF_MATCH.BOTS, match.bots())
                  .set(RWF_MATCH.RECORDING_BYTES, 0L)
                  .set(RWF_MATCH.DROPPED_FRAMES, 0)
                  .execute();
              for (var player : players) {
                dsl.insertInto(RWF_MATCH_PLAYER)
                    .set(RWF_MATCH_PLAYER.MATCH_ID, match.matchId().toString())
                    .set(RWF_MATCH_PLAYER.PLAYER, player.player().toString())
                    .set(RWF_MATCH_PLAYER.TEAM, player.team().name())
                    .set(RWF_MATCH_PLAYER.KIT, player.kit())
                    .set(RWF_MATCH_PLAYER.KILLS, player.kills())
                    .set(RWF_MATCH_PLAYER.DEATHS, player.deaths())
                    .set(RWF_MATCH_PLAYER.RESULT, player.outcome().name())
                    .set(RWF_MATCH_PLAYER.CURRENCY, player.currency().key())
                    .set(RWF_MATCH_PLAYER.CREDITS_OWED, player.creditsOwed())
                    .set(RWF_MATCH_PLAYER.PAYOUT_STATUS, player.status().name())
                    .set(RWF_MATCH_PLAYER.CREDITS_PAID, player.creditsPaid())
                    .execute();
              }
              stats.ifPresent(played -> StatsWrites.write(dsl, match, played));
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> recordingFinished(UUID matchId, RecordingSummary summary) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.update(RWF_MATCH)
                    .set(RWF_MATCH.RECORDING_FILE, summary.file().orElse(null))
                    .set(RWF_MATCH.RECORDING_BYTES, summary.bytes())
                    .set(RWF_MATCH.DROPPED_FRAMES, summary.droppedFrames())
                    .where(RWF_MATCH.ID.eq(matchId.toString()))
                    .execute()));
  }

  @Override
  public CompletableFuture<List<PlayerRow>> unpaid() {
    return database.read(
        dsl ->
            dsl
                .select(RWF_MATCH_PLAYER.fields())
                .from(RWF_MATCH_PLAYER)
                .join(RWF_MATCH)
                .on(RWF_MATCH.ID.eq(RWF_MATCH_PLAYER.MATCH_ID))
                .where(
                    RWF_MATCH_PLAYER.PAYOUT_STATUS.in(
                        PayoutStatus.PENDING.name(), PayoutStatus.PAYING.name()))
                .orderBy(RWF_MATCH.ENDED_AT, RWF_MATCH_PLAYER.PLAYER)
                .fetchInto(RWF_MATCH_PLAYER)
                .stream()
                .map(JooqMatchStore::toRow)
                .toList());
  }

  @Override
  public CompletableFuture<List<PlayerRow>> legacyPayouts(UUID player) {
    return database.read(
        dsl ->
            dsl
                .selectFrom(RWF_MATCH_PLAYER)
                .where(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
                .and(RWF_MATCH_PLAYER.CURRENCY.eq(CurrencyId.CRYSTALS.key()))
                .orderBy(RWF_MATCH_PLAYER.MATCH_ID)
                .fetch()
                .stream()
                .map(JooqMatchStore::toRow)
                .toList());
  }

  @Override
  public CompletableFuture<Void> reconcileLegacy(UUID player, List<LegacyPayment> payments) {
    return Writes.done(
        database.write(
            dsl -> {
              LegacyEarnings.reconcile(dsl, player, payments);
              return true;
            }));
  }

  @Override
  public CompletableFuture<Long> beginPayout(UUID matchId, UUID player, LocalDate today) {
    return database.write(
        dsl -> {
          var row = fetch(dsl, matchId, player);
          var owed = row.getCreditsOwed();
          return switch (PayoutStatus.valueOf(row.getPayoutStatus())) {
            case NONE, PAID -> 0L;
            case PAYING -> owed < 0 ? owed : row.getCreditsPaid();
            case PENDING -> {
              var legacy = CurrencyId.fromKey(row.getCurrency()) == CurrencyId.CRYSTALS;
              var amount = legacy ? reserveLegacy(dsl, player, today, owed) : owed;
              dsl.update(RWF_MATCH_PLAYER)
                  .set(RWF_MATCH_PLAYER.PAYOUT_STATUS, PayoutStatus.PAYING.name())
                  .set(RWF_MATCH_PLAYER.CREDITS_PAID, amount < 0 ? 0L : amount)
                  .where(RWF_MATCH_PLAYER.MATCH_ID.eq(matchId.toString()))
                  .and(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
                  .execute();
              yield amount;
            }
          };
        });
  }

  /** Cuts a legacy crystal payout to what is left of {@code today}'s cap and reserves it. */
  private static long reserveLegacy(DSLContext dsl, UUID player, LocalDate today, long owed) {
    var earned =
        dsl.select(RWF_DAILY_EARNINGS.CREDITS)
            .from(RWF_DAILY_EARNINGS)
            .where(RWF_DAILY_EARNINGS.PLAYER.eq(player.toString()))
            .and(RWF_DAILY_EARNINGS.DAY.eq(today.toString()))
            .fetchOptional(RWF_DAILY_EARNINGS.CREDITS)
            .orElse(0L);
    var amount = Math.max(0, Math.min(owed, LEGACY_CRYSTAL_DAILY_CAP - earned));
    dsl.insertInto(RWF_DAILY_EARNINGS)
        .set(RWF_DAILY_EARNINGS.PLAYER, player.toString())
        .set(RWF_DAILY_EARNINGS.DAY, today.toString())
        .set(RWF_DAILY_EARNINGS.CREDITS, earned + amount)
        .onConflict(RWF_DAILY_EARNINGS.PLAYER, RWF_DAILY_EARNINGS.DAY)
        .doUpdate()
        .set(RWF_DAILY_EARNINGS.CREDITS, earned + amount)
        .execute();
    return amount;
  }

  @Override
  public CompletableFuture<Void> finishPayout(UUID matchId, UUID player, long paid) {
    return Writes.done(
        database.write(
            dsl -> {
              // The row refuses an amount that exceeds or opposes what was owed.
              var _ = toRow(fetch(dsl, matchId, player)).paid(paid);
              var updated =
                  dsl.update(RWF_MATCH_PLAYER)
                      .set(RWF_MATCH_PLAYER.PAYOUT_STATUS, PayoutStatus.PAID.name())
                      .set(RWF_MATCH_PLAYER.CREDITS_PAID, paid)
                      .where(RWF_MATCH_PLAYER.MATCH_ID.eq(matchId.toString()))
                      .and(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
                      .and(RWF_MATCH_PLAYER.PAYOUT_STATUS.eq(PayoutStatus.PAYING.name()))
                      .execute();
              if (updated != 1) {
                throw new IllegalStateException(
                    player + " in match " + matchId + " was not paying; nothing to finish");
              }
              return true;
            }));
  }

  @Override
  public CompletableFuture<List<PlayerRow>> players(UUID matchId) {
    return database.read(
        dsl ->
            dsl
                .selectFrom(RWF_MATCH_PLAYER)
                .where(RWF_MATCH_PLAYER.MATCH_ID.eq(matchId.toString()))
                .orderBy(RWF_MATCH_PLAYER.PLAYER)
                .fetch()
                .stream()
                .map(JooqMatchStore::toRow)
                .toList());
  }

  @Override
  public CompletableFuture<Career> career(UUID player) {
    return database.read(
        dsl -> {
          var rows =
              dsl
                  .selectFrom(RWF_MATCH_PLAYER)
                  .where(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
                  .fetch()
                  .stream()
                  .map(JooqMatchStore::toRow)
                  .toList();
          return new Career(
              rows.size(),
              (int) rows.stream().filter(row -> row.outcome() == Outcome.WIN).count(),
              (int) rows.stream().filter(row -> row.outcome() == Outcome.LOSE).count(),
              rows.stream().mapToInt(PlayerRow::kills).sum(),
              rows.stream().mapToInt(PlayerRow::deaths).sum());
        });
  }

  private static RwfMatchPlayerRecord fetch(DSLContext dsl, UUID matchId, UUID player) {
    var row =
        dsl.selectFrom(RWF_MATCH_PLAYER)
            .where(RWF_MATCH_PLAYER.MATCH_ID.eq(matchId.toString()))
            .and(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
            .fetchOne();
    if (row == null) {
      throw new IllegalStateException(player + " has no row in match " + matchId);
    }
    return row;
  }

  private static PlayerRow toRow(RwfMatchPlayerRecord row) {
    return new PlayerRow(
        UUID.fromString(row.getMatchId()),
        UUID.fromString(row.getPlayer()),
        TeamColor.valueOf(row.getTeam()),
        row.getKit(),
        row.getKills(),
        row.getDeaths(),
        Outcome.valueOf(row.getResult()),
        CurrencyId.fromKey(row.getCurrency()),
        row.getCreditsOwed(),
        PayoutStatus.valueOf(row.getPayoutStatus()),
        row.getCreditsPaid());
  }
}
