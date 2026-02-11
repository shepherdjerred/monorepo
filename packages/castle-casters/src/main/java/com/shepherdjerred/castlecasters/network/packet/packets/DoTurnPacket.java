package com.shepherdjerred.castlecasters.network.packet.packets;

import com.shepherdjerred.castlecasters.logic.turn.Turn;

public record DoTurnPacket(Turn turn) implements Packet {

}
