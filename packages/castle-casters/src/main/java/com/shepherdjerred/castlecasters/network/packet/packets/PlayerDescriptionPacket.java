package com.shepherdjerred.castlecasters.network.packet.packets;

import com.shepherdjerred.castlecasters.common.player.PlayerInformation;

public record PlayerDescriptionPacket(PlayerInformation playerInformation) implements Packet {

}
