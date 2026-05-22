package com.shepherdjerred.castlecasters.network.packet.packets;

import com.shepherdjerred.castlecasters.common.player.Player;

public record PlayerJoinPacket(Player player) implements Packet {

}
