package com.shepherdjerred.castlecasters.game.event.events;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public record DoTurnEvent(Turn turn) implements Event {
}
