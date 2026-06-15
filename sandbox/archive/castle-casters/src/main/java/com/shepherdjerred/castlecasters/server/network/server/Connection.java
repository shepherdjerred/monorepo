package com.shepherdjerred.castlecasters.server.network.server;


import com.shepherdjerred.castlecasters.network.packet.packets.Packet;

public interface Connection {

  void sendPacket(Packet packet);

  void disconnect();

  Status getStatus();

  enum Status {
    CONNECTING, CONNECTED, DISCONNECTED, DISCONNECTED_BY_SERVER
  }
}
