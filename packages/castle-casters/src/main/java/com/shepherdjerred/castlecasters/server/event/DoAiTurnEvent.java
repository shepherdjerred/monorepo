package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.events.Event;

public record DoAiTurnEvent(Player player) implements Event {

}
