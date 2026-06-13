package com.shepherdjerred.castlecasters.server.network.event.events;

import com.shepherdjerred.castlecasters.server.network.server.Connection;

public record ClientConnectedEvent(Connection connection) implements NetworkEvent {

}
