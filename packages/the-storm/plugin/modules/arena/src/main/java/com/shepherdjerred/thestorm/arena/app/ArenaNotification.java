package com.shepherdjerred.thestorm.arena.app;

import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import java.util.List;

/**
 * One accepted arena transition, delivered to {@link ArenaEvents} subscribers on the main thread
 * after every effect has been carried out.
 *
 * @param event the event the game accepted
 * @param effects what the server did in response, in order
 * @param before the game before the event
 * @param after the game afterwards
 */
public record ArenaNotification(
    GameEvent event, List<GameEffect> effects, ArenaGame before, ArenaGame after) {

  public ArenaNotification {
    effects = List.copyOf(effects);
  }
}
