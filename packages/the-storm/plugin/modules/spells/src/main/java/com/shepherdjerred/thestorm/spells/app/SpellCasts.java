package com.shepherdjerred.thestorm.spells.app;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** A spell that went off. Listeners run on the main thread. Casts are not stored. */
public final class SpellCasts {

  private final List<Consumer<Cast>> listeners = new ArrayList<>();

  public void subscribe(Consumer<Cast> listener) {
    listeners.add(listener);
  }

  public void cast(UUID player, String spell) {
    var event = new Cast(player, spell);
    List.copyOf(listeners).forEach(listener -> listener.accept(event));
  }

  /**
   * A spell that went off.
   *
   * @param player who cast it
   * @param spell the spell id
   */
  public record Cast(UUID player, String spell) {

    public Cast {
      if (spell.isBlank()) {
        throw new IllegalArgumentException("spell id is blank");
      }
    }
  }
}
