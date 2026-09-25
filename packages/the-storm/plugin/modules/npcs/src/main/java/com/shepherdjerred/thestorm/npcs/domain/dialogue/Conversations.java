package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Which screen each player has open, so a button press counts once.
 *
 * <p>Every shown screen gets a fresh token. A click names the token and button it came from; it is
 * honored only if that screen is still the player's open one, and honoring it closes the screen. A
 * repeated click (the Dialog API can deliver one twice), a click on a screen that has since been
 * replaced, or a click after the player walked away is ignored. Main thread only.
 */
public final class Conversations {

  private final Map<UUID, Open> open = new HashMap<>();
  private long lastToken;

  /** A screen a player has open. */
  public record Open(long token, String npc, Screen screen) {}

  /** A click that counted: which NPC it was for and what the button asked for. */
  public record Clicked(String npc, Choice choice) {}

  /** Records that {@code player} now sees {@code screen} from {@code npc}; returns its token. */
  public long show(UUID player, String npc, Screen screen) {
    lastToken++;
    open.put(player, new Open(lastToken, npc, screen));
    return lastToken;
  }

  /** Honors a click at most once; empty for stale, repeated or out-of-range clicks. */
  public Optional<Clicked> click(UUID player, long token, int button) {
    var current = open.get(player);
    if (current == null
        || current.token() != token
        || button < 0
        || button >= current.screen().buttons().size()) {
      return Optional.empty();
    }
    open.remove(player);
    return Optional.of(new Clicked(current.npc(), current.screen().buttons().get(button).choice()));
  }

  /** The screen {@code player} has open, if any. */
  public Optional<Open> current(UUID player) {
    return Optional.ofNullable(open.get(player));
  }

  /** Forgets {@code player}'s open screen (they quit or closed it). */
  public void forget(UUID player) {
    open.remove(player);
  }
}
