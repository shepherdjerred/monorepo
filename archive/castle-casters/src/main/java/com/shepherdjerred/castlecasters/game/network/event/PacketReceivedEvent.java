package com.shepherdjerred.castlecasters.game.network.event;

import com.shepherdjerred.castlecasters.network.packet.packets.Packet;

public record PacketReceivedEvent(Packet packet) implements NetworkEvent {

}
