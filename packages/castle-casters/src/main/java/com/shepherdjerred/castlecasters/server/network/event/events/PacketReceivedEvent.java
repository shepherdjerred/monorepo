package com.shepherdjerred.castlecasters.server.network.event.events;

import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import com.shepherdjerred.castlecasters.server.network.server.Connection;

public record PacketReceivedEvent(Connection connection, Packet packet) implements NetworkEvent {

}

