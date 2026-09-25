package com.shepherdjerred.thestorm.spells.domain;

import static java.util.stream.Collectors.joining;

import java.time.Duration;
import java.util.Locale;
import java.util.Map;

/** The fixed player-facing wording of each {@link Refusal}. */
public final class RefusalText {

  private RefusalText() {}

  public static String describe(Refusal refusal) {
    return switch (refusal) {
      case Refusal.Disabled() -> "That spell is not available on this server.";
      case Refusal.TierTooLow(var required, var held) ->
          "You need Spellcaster " + roman(required) + " (you are " + level(held) + ").";
      case Refusal.NotLearned() -> "You have not learned that spell yet.";
      case Refusal.Silenced(var remaining) -> "You are silenced for " + seconds(remaining) + ".";
      case Refusal.OnCooldown(var remaining) -> "Ready again in " + seconds(remaining) + ".";
      case Refusal.MissingReagents(var missing) -> "You need " + reagents(missing) + " more.";
      case Refusal.NoTarget(var what) -> "No " + what + " to target.";
      case Refusal.NoSafeSpot() -> "There is nowhere safe to land there.";
      case Refusal.NoMark() -> "You have no Mark to return to.";
      case Refusal.NoWall() -> "There is no wall in front of you to pass through.";
      case Refusal.Loading() -> "Your spellbook is still loading. Try again in a moment.";
      case Refusal.NotYourFocus() -> "This focus is bound to someone else.";
      case Refusal.StaleFocus() -> "This focus has faded; bind the spell again.";
      case Refusal.InventoryFull() -> "Make room in your inventory first.";
    };
  }

  /** Roman numerals for track tiers I to V. */
  public static String roman(int tier) {
    return switch (tier) {
      case 1 -> "I";
      case 2 -> "II";
      case 3 -> "III";
      case 4 -> "IV";
      case 5 -> "V";
      default -> throw new IllegalArgumentException("tier must be 1..5: " + tier);
    };
  }

  /** "Spellcaster I" style for a held level, "untrained" for zero. */
  private static String level(int held) {
    return held == 0 ? "untrained" : "Spellcaster " + roman(held);
  }

  /** A duration as whole seconds, rounded up so "0s" is never shown for a remaining wait. */
  public static String seconds(Duration duration) {
    var millis = duration.toMillis();
    var seconds = Math.max(1, (millis + 999) / 1000);
    if (seconds < 60) {
      return seconds + "s";
    }
    var minutes = seconds / 60;
    var rest = seconds % 60;
    return rest == 0 ? minutes + "m" : minutes + "m " + rest + "s";
  }

  /** "15 redstone, 2 lapis lazuli" from material names, in material order. */
  public static String reagents(Map<String, Integer> amounts) {
    return amounts.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .map(entry -> entry.getValue() + " " + materialName(entry.getKey()))
        .collect(joining(", "));
  }

  /** {@code LAPIS_LAZULI} as "lapis lazuli". */
  public static String materialName(String material) {
    return material.toLowerCase(Locale.ROOT).replace('_', ' ');
  }
}
