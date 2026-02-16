package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public record DoTurnEvent(Turn turn) implements Event {

}
