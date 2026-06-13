package com.shepherdjerred.castlecasters.server.network.manager.events;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.events.Event;

public record StartBroadcastEvent(Lobby lobby) implements Event {
}
