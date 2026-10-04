package com.shepherdjerred.thestorm.rwf.app.store;

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
  }

  /** Where a player's credits are. */
  enum PayoutStatus {
    /** Nothing is owed. */
    NONE,
    /** Owed and not yet paid. */
    PENDING,
    /** The daily cap has been applied and the ledger transfer is in flight or uncertain. */
    PAYING,
    /** The ledger confirmed the transfer. */
    PAID,
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
   * @param creditsOwed what the rules awarded them before the daily cap
   * @param status where the payout is
   * @param creditsPaid what was (or is being) paid after the daily cap; 0 until {@link
   *     PayoutStatus#PAYING}
   */
  record PlayerRow(
      UUID matchId,
      UUID player,
      TeamColor team,
      String kit,
      int kills,
      int deaths,
      Outcome outcome,
      long creditsOwed,
      PayoutStatus status,
      long creditsPaid) {

    public PlayerRow {
      if (kills < 0 || deaths < 0 || creditsOwed < 0 || creditsPaid < 0) {
        throw new IllegalArgumentException("counts and credits must not be negative");
      }
      if ((creditsOwed == 0) != (status == PayoutStatus.NONE)) {
        throw new IllegalArgumentException("a row owes credits exactly when it has a payout");
      }
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

  /**
   * Moves a pending row to paying: applies the daily cap against {@code day}'s earnings, reserves
   * the amount in the daily ledger and stores it as {@code creditsPaid}. Returns the amount to
   * transfer, which may be zero. Calling it again for a row already paying returns the stored
   * amount without reserving more; a paid row returns zero.
   */
  CompletableFuture<Long> beginPayout(UUID matchId, UUID player, LocalDate day, long dailyCap);

  /** Marks a paying row paid, once the ledger confirmed the transfer. */
  CompletableFuture<Void> finishPayout(UUID matchId, UUID player);

  /** The player's rows for one match, for diagnostics. */
  CompletableFuture<List<PlayerRow>> players(UUID matchId);
}
