package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.events.Event;

public record LobbyUpdatedEvent(Lobby newLobby) implements Event {
}
