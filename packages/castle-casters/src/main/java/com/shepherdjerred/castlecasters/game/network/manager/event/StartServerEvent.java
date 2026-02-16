package com.shepherdjerred.castlecasters.game.network.manager.event;

import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.events.Event;

public record StartServerEvent(GameState gameState) implements Event {
}
