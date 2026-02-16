package com.shepherdjerred.castlecasters.network.packet.packets;

import com.shepherdjerred.castlecasters.common.lobby.Lobby;

public record ServerBroadcastPacket(Lobby lobby) implements Packet {

}
