package com.shepherdjerred.thestorm.npcs.domain.trainer;

import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Button;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import java.util.ArrayList;
import java.util.List;

/**
 * The trainer's two screens: what the next level costs (with a Buy button when the player may buy
 * it), and the confirmation before paying.
 */
public final class TrainerScreens {

  private TrainerScreens() {}

  /**
   * A player's standing in the trainer's track.
   *
   * @param trackName the track's display name
   * @param level the player's level, 0 when untrained
   * @param maxLevel the top level
   */
  public record Standing(String trackName, int level, int maxLevel) {}

  /** What the tracks module said about the next level. */
  public sealed interface Quote {

    /** The player may buy {@code offer}, which costs {@code costText}. */
    record Quoted(Offer offer, String costText) implements Quote {}

    /** The player may not buy the next level, for these reasons. */
    record Refused(List<String> reasons) implements Quote {

      public Refused {
        reasons = List.copyOf(reasons);
        if (reasons.isEmpty()) {
          throw new IllegalArgumentException("a refusal needs a reason");
        }
      }
    }
  }

  /**
   * The offer screen. {@code note} (such as the result of a purchase) leads the body if present.
   */
  public static Screen offer(String title, Standing standing, Quote quote, String note) {
    var body = new ArrayList<String>();
    if (!note.isBlank()) {
      body.add(note);
    }
    body.add(
        standing.trackName() + ": level " + standing.level() + " of " + standing.maxLevel() + ".");
    var buttons = new ArrayList<Button>();
    switch (quote) {
      case Quote.Quoted(var offer, var costText) -> {
        body.add("Level " + offer.level() + " costs " + costText + ".");
        buttons.add(new Button("Buy level " + offer.level(), new Choice.Buy(offer)));
      }
      case Quote.Refused(var reasons) -> body.addAll(reasons);
    }
    buttons.add(new Button("Close", new Choice.Close()));
    return new Screen(title, String.join("\n", body), buttons);
  }

  /** The confirmation screen for {@code offer}. */
  public static Screen confirm(String title, String trackName, Offer offer, String costText) {
    return new Screen(
        title,
        "Buy " + trackName + " level " + offer.level() + " for " + costText + "?",
        List.of(
            new Button("Confirm", new Choice.Confirm(offer)),
            new Button("Back", new Choice.OpenTrainer())));
  }
}
