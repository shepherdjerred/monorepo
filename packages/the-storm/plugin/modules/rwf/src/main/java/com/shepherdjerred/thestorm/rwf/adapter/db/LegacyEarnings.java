package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_DAILY_EARNINGS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_MATCH_PLAYER;

import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfMatchPlayerRecord;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

/**
 * Rebuilds legacy cap totals and uncertain reservations together, inside one writer transaction.
 */
final class LegacyEarnings {

  private LegacyEarnings() {}

  static void reconcile(DSLContext dsl, UUID player, List<MatchStore.LegacyPayment> payments) {
    var byMatch =
        payments.stream()
            .collect(Collectors.toUnmodifiableMap(MatchStore.LegacyPayment::matchId, p -> p));
    var rows =
        dsl.selectFrom(RWF_MATCH_PLAYER)
            .where(RWF_MATCH_PLAYER.PLAYER.eq(player.toString()))
            .and(RWF_MATCH_PLAYER.CURRENCY.eq(CurrencyId.CRYSTALS.key()))
            .fetch();
    if (!rows.stream()
        .map(r -> UUID.fromString(r.getMatchId()))
        .toList()
        .containsAll(byMatch.keySet())) {
      throw new IllegalArgumentException("legacy receipts name another player's match");
    }
    var totals = new HashMap<LocalDate, Long>();
    for (var row : rows) {
      var payment = byMatch.get(UUID.fromString(row.getMatchId()));
      validate(row, payment);
      if (payment != null) {
        totals.merge(payment.day(), payment.credits(), Math::addExact);
      }
      reconcileReservation(dsl, row, payment);
    }
    dsl.deleteFrom(RWF_DAILY_EARNINGS)
        .where(RWF_DAILY_EARNINGS.PLAYER.eq(player.toString()))
        .execute();
    for (Map.Entry<LocalDate, Long> total : totals.entrySet()) {
      dsl.insertInto(RWF_DAILY_EARNINGS)
          .set(RWF_DAILY_EARNINGS.PLAYER, player.toString())
          .set(RWF_DAILY_EARNINGS.DAY, total.getKey().toString())
          .set(RWF_DAILY_EARNINGS.CREDITS, total.getValue())
          .execute();
    }
  }

  private static void validate(
      RwfMatchPlayerRecord row, MatchStore.@Nullable LegacyPayment payment) {
    var status = MatchStore.PayoutStatus.valueOf(row.getPayoutStatus());
    if (payment == null) {
      if (status == MatchStore.PayoutStatus.PAID && row.getCreditsPaid() != 0) {
        throw new IllegalStateException("paid legacy payout has no receipt: " + row.getMatchId());
      }
    } else if (payment.credits() > row.getCreditsOwed()
        || status == MatchStore.PayoutStatus.NONE
        || (status == MatchStore.PayoutStatus.PAID && payment.credits() != row.getCreditsPaid())) {
      throw new IllegalStateException("legacy receipt disagrees with " + row.getMatchId());
    }
  }

  private static void reconcileReservation(
      DSLContext dsl, RwfMatchPlayerRecord row, MatchStore.@Nullable LegacyPayment payment) {
    var status = MatchStore.PayoutStatus.valueOf(row.getPayoutStatus());
    if (status == MatchStore.PayoutStatus.PAYING || status == MatchStore.PayoutStatus.PENDING) {
      dsl.update(RWF_MATCH_PLAYER)
          .set(
              RWF_MATCH_PLAYER.PAYOUT_STATUS,
              payment == null
                  ? MatchStore.PayoutStatus.PENDING.name()
                  : MatchStore.PayoutStatus.PAYING.name())
          .set(RWF_MATCH_PLAYER.CREDITS_PAID, payment == null ? 0L : payment.credits())
          .where(RWF_MATCH_PLAYER.MATCH_ID.eq(row.getMatchId()))
          .and(RWF_MATCH_PLAYER.PLAYER.eq(row.getPlayer()))
          .execute();
    }
  }
}
