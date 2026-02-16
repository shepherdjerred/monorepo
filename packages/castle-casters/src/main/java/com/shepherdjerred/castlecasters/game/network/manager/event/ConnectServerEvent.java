package com.shepherdjerred.castlecasters.game.network.manager.event;

import com.shepherdjerred.castlecasters.events.Event;

import java.net.SocketAddress;

public record ConnectServerEvent(SocketAddress address) implements Event {

}
