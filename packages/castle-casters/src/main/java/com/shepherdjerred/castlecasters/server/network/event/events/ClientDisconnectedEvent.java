package com.shepherdjerred.castlecasters.server.network.event.events;

import com.shepherdjerred.castlecasters.server.network.server.Connection;

public record ClientDisconnectedEvent(Connection connection) implements NetworkEvent {

}
