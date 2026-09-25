package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Duration;
import java.time.InstantSource;
import java.util.Locale;
import java.util.function.LongFunction;

/** What a trainer says when a purchase cannot happen. */
public final class TrainerWording {

  private final LongFunction<String> crystals;
  private final InstantSource time;

  /**
   * @param crystals formats an amount of crystals for a sentence
   * @param time the clock, for cooldowns
   */
  public TrainerWording(LongFunction<String> crystals, InstantSource time) {
    this.crystals = crystals;
    this.time = time;
  }

  /** The track's name as players read it, such as {@code Shopkeeper}. */
  public static String trackName(Track track) {
    var id = track.id();
    return id.substring(0, 1).toUpperCase(Locale.ROOT) + id.substring(1);
  }

  public String crystals(long amount) {
    return crystals.apply(amount);
  }

  public String explain(PurchaseProblem problem) {
    return switch (problem) {
      case PurchaseProblem.AlreadyMaxed(var track) ->
          "You have mastered " + trackName(track) + ". There is nothing left to teach you.";
      case PurchaseProblem.NotNextLevel(var track, var current, var _) ->
          trackName(track) + " levels are learned in order; you are level " + current + ".";
      case PurchaseProblem.AbovePrimary(var track, var _, var primary, var primaryLevel) ->
          trackName(track)
              + " can't pass your primary track, "
              + trackName(primary)
              + " (level "
              + primaryLevel
              + "). Train "
              + trackName(primary)
              + " first.";
      case PurchaseProblem.CoolingDown(var availableAt) ->
          "You trained recently. Come back in "
              + wait(Duration.between(time.instant(), availableAt))
              + ".";
      case PurchaseProblem.CannotAfford(var cost, var balance) ->
          "That costs " + crystals(cost) + ", and you have " + crystals(balance) + ".";
      case PurchaseProblem.QuoteChanged _ ->
          "The price changed while you decided; here is the new offer.";
      case PurchaseProblem.StillLoading() ->
          "Your training records are still loading. Try again in a moment.";
      case PurchaseProblem.LoadFailed() ->
          "Your training records could not be loaded. Try again shortly.";
      case PurchaseProblem.ShuttingDown() -> "The server is restarting. Try again after.";
      case PurchaseProblem.AlreadyBuying() -> "Your last purchase is still going through.";
      case PurchaseProblem.NotRecorded _ ->
          "The lesson could not be recorded, so your crystals were refunded.";
    };
  }

  /** A wait in whole hours and minutes, rounded up, at least one minute. */
  static String wait(Duration duration) {
    var minutes = Math.max(1, (duration.toSeconds() + 59) / 60);
    var hours = minutes / 60;
    var rest = minutes % 60;
    if (hours == 0) {
      return plural(rest, "minute");
    }
    return rest == 0 ? plural(hours, "hour") : plural(hours, "hour") + " " + plural(rest, "minute");
  }

  private static String plural(long count, String unit) {
    return count + " " + unit + (count == 1 ? "" : "s");
  }
}
