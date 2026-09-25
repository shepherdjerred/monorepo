package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Duration;
import java.time.Instant;

/** Player-facing sentences for purchase and admin problems. */
public final class Explanations {

  private final TracksConfig config;

  public Explanations(TracksConfig config) {
    this.config = config;
  }

  /** {@code track}'s display name, for example "Mechanic". */
  public String name(Track track) {
    return config.info(track).displayName();
  }

  /** {@code track} at {@code level}, for example "Mechanic III". */
  public String ranked(Track track, int level) {
    return name(track) + " " + Wording.numeral(level);
  }

  /** What {@code quote} buys and costs, for example "Mechanic II for 1,500 crystals". */
  public String offer(Quote quote) {
    return ranked(quote.track(), quote.level()) + " for " + Wording.crystals(quote.cost());
  }

  /** Why a purchase was refused, as of {@code now}. */
  public String explain(PurchaseProblem problem, Instant now) {
    return switch (problem) {
      case PurchaseProblem.AlreadyMaxed(var track) ->
          name(track) + " is already at its highest level.";
      case PurchaseProblem.NotNextLevel(var track, var current, var requested) ->
          notNext(track, current, requested);
      case PurchaseProblem.AbovePrimary(var track, var requested, var primary, var primaryLevel) ->
          "Your primary track is "
              + ranked(primary, primaryLevel)
              + "; it must reach "
              + Wording.numeral(requested)
              + " before "
              + name(track)
              + " can.";
      case PurchaseProblem.CoolingDown(var availableAt) ->
          "You can train again in " + Wording.wait(Duration.between(now, availableAt)) + ".";
      case PurchaseProblem.CannotAfford(var cost, var balance) ->
          "You need " + Wording.crystals(cost) + " and have " + Wording.crystals(balance) + ".";
      case PurchaseProblem.QuoteChanged(var offered, var current) ->
          "The offer changed from " + offer(offered) + " to " + offer(current) + "; check again.";
      case PurchaseProblem.StillLoading() ->
          "Your tracks are still loading; try again in a moment.";
      case PurchaseProblem.AlreadyBuying() ->
          "You are already buying a level; wait for it to finish.";
      case PurchaseProblem.NotRecorded(var quote) ->
          "Buying "
              + ranked(quote.track(), quote.level())
              + " could not be saved, so your crystals were refunded. Try again.";
    };
  }

  /** Why an administrator's change was refused. */
  public String explain(AdminProblem problem) {
    return switch (problem) {
      case AdminProblem.AbovePrimary(var track, var level, var primary, var primaryLevel) ->
          ranked(track, level)
              + " would pass the primary track, "
              + ranked(primary, primaryLevel)
              + ".";
      case AdminProblem.BelowSecondary(var primary, var level, var secondary, var secondaryLevel) ->
          "The primary track, "
              + name(primary)
              + ", cannot go below "
              + ranked(secondary, secondaryLevel)
              + (level == 0 ? "." : " (asked for " + Wording.numeral(level) + ").");
      case AdminProblem.WouldChangePrimary(var primary) ->
          name(primary) + " is the primary track; use /perks admin reset to change it.";
    };
  }

  private String notNext(Track track, int current, int requested) {
    if (current == 0) {
      return "Start " + name(track) + " at I.";
    }
    return requested <= current
        ? "You already have " + ranked(track, current) + "."
        : "Train " + ranked(track, current + 1) + " first.";
  }
}
