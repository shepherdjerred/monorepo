package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public record TryDoTurnEvent(Turn turn) implements Event {

}
