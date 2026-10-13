package com.shepherdjerred.thestorm.rwf.app.store;

import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Finished matches, who fought in them, and the payout outbox. A match and its players are written
 * in one transaction when it ends; each human's credits sit in the outbox until the economy ledger
 * confirms the transfer, so a crash between the two never loses or doubles a payment.
 */
public interface MatchStore {

  /**
   * The daily cap rwf.yml set while matches paid crystals. Rows written before Red Warfare had its
   * own currency settle under it, against {@code rwf_daily_earnings}, reconciled from committed
   * receipts. Uncommitted payouts use the current day's remaining budget; credit rows have no cap.
   */
  long LEGACY_CRYSTAL_DAILY_CAP = 30;

  /**
   * One finished match.
   *
   * @param matchId the match
   * @param mapId the map played
   * @param startedAt when it went live, or when it was stopped if it never did
   * @param endedAt when it ended
   * @param winner the winning team, if one team outlived the rest
   * @param humans how many humans were in it when it went live
   * @param bots how many bots were
   */
  record MatchRow(
      UUID matchId,
      String mapId,
      Instant startedAt,
      Instant endedAt,
      Optional<TeamColor> winner,
      int humans,
      int bots) {

    public MatchRow {
      if (humans < 0 || bots < 0) {
        throw new IllegalArgumentException("counts must not be negative");
      }
      if (endedAt.isBefore(startedAt)) {
        throw new IllegalArgumentException("a match cannot end before it starts");
      }
    }
  }

  /** How a player's match went. */
  enum Outcome {
    WIN,
    LOSE,
    LEFT,
    STOPPED,
    /** AFK for the whole match: charged the AFK penalty instead of any pay. */
    AFK,
    /** Threw the match away with a suicide or a quit death while it was live: no pay. */
    FORFEITED;

    /**
     * How a human's match went: left while it was live (dead or alive), forfeited by a suicide or
     * quit death, charged as AFK ({@code credits} negative), or won or lost.
     */
    public static Outcome of(boolean left, boolean forfeited, boolean won, long credits) {
      if (left) {
        return LEFT;
      }
      if (forfeited) {
        return FORFEITED;
      }
      if (credits < 0) {
        return AFK;
      }
      return won ? WIN : LOSE;
    }
  }

  /** Where a player's credits are. */
  enum PayoutStatus {
    /** Nothing is owed. */
    NONE,
    /** Owed and not yet paid. */
    PENDING,
    /** The ledger transfer is in flight or uncertain. */
    PAYING,
    /** The ledger confirmed the transfer. */
    PAID;

    /** A new row's status: pending while it owes or is charged anything, otherwise none. */
    public static PayoutStatus owing(long credits) {
      return credits == 0 ? NONE : PENDING;
    }
  }

  /**
   * One human in a finished match.
   *
   * @param matchId the match
   * @param player the player
   * @param team their team
   * @param kit the kit they played
   * @param kills kills credited to them
   * @param deaths how many times they died (0 or 1 in Search and Destroy)
   * @param outcome how their match went
   * @param currency what the row pays in: Red Warfare credits, or crystals for rows written before
   *     Red Warfare had its own currency
   * @param creditsOwed what the rules awarded them: positive is paid to them, negative is the most
   *     taken from them (the AFK penalty)
   * @param status where the payout is
   * @param creditsPaid what actually moved, with the same sign as {@code creditsOwed}; a charge
   *     takes no more than the player holds. 0 until the transfer is known
   */
  record PlayerRow(
      UUID matchId,
      UUID player,
      TeamColor team,
      String kit,
      int kills,
      int deaths,
      Outcome outcome,
      CurrencyId currency,
      long creditsOwed,
      PayoutStatus status,
      long creditsPaid) {

    public PlayerRow {
      if (kills < 0 || deaths < 0) {
        throw new IllegalArgumentException("counts must not be negative");
      }
      if ((creditsOwed == 0) != (status == PayoutStatus.NONE)) {
        throw new IllegalArgumentException("a row owes credits exactly when it has a payout");
      }
      if (creditsPaid != 0
          && (Long.signum(creditsPaid) != Long.signum(creditsOwed)
              || Math.abs(creditsPaid) > Math.abs(creditsOwed))) {
        throw new IllegalArgumentException(
            "paid " + creditsPaid + " cannot exceed or oppose owed " + creditsOwed);
      }
    }

    /** The same row, paid: {@code amount} actually moved. */
    public PlayerRow paid(long amount) {
      return new PlayerRow(
          matchId,
          player,
          team,
          kit,
          kills,
          deaths,
          outcome,
          currency,
          creditsOwed,
          PayoutStatus.PAID,
          amount);
    }

    /** The same row with another outcome. */
    public PlayerRow withOutcome(Outcome newOutcome) {
      return new PlayerRow(
          matchId,
          player,
          team,
          kit,
          kills,
          deaths,
          newOutcome,
          currency,
          creditsOwed,
          status,
          creditsPaid);
    }
  }

  /**
   * A player's tally.
   *
   * @param kills kills credited
   * @param deaths deaths
   */
  record Stats(int kills, int deaths) {

    public static final Stats NONE = new Stats(0, 0);
  }

  /** Writes a match and its players together; the players' credits enter the outbox. */
  CompletableFuture<Void> record(MatchRow match, List<PlayerRow> players);

  /** Attaches the finished recording's file, size and dropped-frame count to a match. */
  CompletableFuture<Void> recordingFinished(UUID matchId, RecordingSummary summary);

  /** Every row still {@link PayoutStatus#PENDING} or {@link PayoutStatus#PAYING}, oldest first. */
  CompletableFuture<List<PlayerRow>> unpaid();

  /** Every legacy crystal row for a player, including completed payouts whose receipts count. */
  CompletableFuture<List<PlayerRow>> legacyPayouts(UUID player);

  /**
   * A committed legacy payout, dated in the legacy accounting zone.
   *
   * @param matchId its match
   * @param day the receipt's day
   * @param credits what the ledger actually paid
   */
  record LegacyPayment(UUID matchId, LocalDate day, long credits) {

    public LegacyPayment {
      if (credits <= 0) {
        throw new IllegalArgumentException("a committed legacy payout must be positive");
      }
    }
  }

  /**
   * Rebuilds the player's daily accounting from validated receipts and resets uncommitted legacy
   * reservations for settlement against today's budget. The payout service serializes this with all
   * transfers; it must never run while a transfer is in flight.
   */
  CompletableFuture<Void> reconcileLegacy(UUID player, List<LegacyPayment> payments);

  /**
   * Moves a pending row to paying and returns the amount to move: a payout's {@code creditsOwed},
   * stored as {@code creditsPaid}, or a charge's (negative) {@code creditsOwed}, whose actual
   * amount is only known once it is taken. A legacy crystal row is first cut to what is left of
   * {@link #LEGACY_CRYSTAL_DAILY_CAP} for {@code today} and reserved there, as before. Calling it
   * again for a row already paying returns the same amount (a payout's stored {@code creditsPaid});
   * a paid row or one owing nothing returns zero.
   */
  CompletableFuture<Long> beginPayout(UUID matchId, UUID player, LocalDate today);

  /** Marks a paying row paid with what actually moved, once the ledger confirmed it. */
  CompletableFuture<Void> finishPayout(UUID matchId, UUID player, long paid);

  /** The player's rows for one match, for diagnostics. */
  CompletableFuture<List<PlayerRow>> players(UUID matchId);

  /** {@code player}'s totals over every recorded match. */
  CompletableFuture<Career> career(UUID player);

  /**
   * A player's record across matches. Matches they left or that were stopped count only towards
   * {@code matches}.
   *
   * @param matches matches recorded with them in
   * @param wins matches their team won
   * @param losses matches their team lost
   * @param kills kills credited
   * @param deaths deaths
   */
  record Career(int matches, int wins, int losses, int kills, int deaths) {

    public Career {
      if (matches < 0 || wins < 0 || losses < 0 || kills < 0 || deaths < 0) {
        throw new IllegalArgumentException("career totals must not be negative");
      }
      if (wins + losses > matches) {
        throw new IllegalArgumentException("more results than matches");
      }
    }
  }
}
