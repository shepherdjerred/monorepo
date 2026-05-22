package com.shepherdjerred.castlecasters.network.packet.serialization;


import com.shepherdjerred.castlecasters.network.packet.packets.Packet;

public interface PacketSerializer {

  byte[] toBytes(Packet packet);

  Packet fromBytes(byte[] packetAsBytes);
}
