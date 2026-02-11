package com.shepherdjerred.castlecasters.server.network.server.netty;

import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import com.shepherdjerred.castlecasters.server.network.server.Connection;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import lombok.ToString;

@ToString(exclude = "handler")
@RequiredArgsConstructor
public class NettyConnection implements Connection {

  private final ServerChannelHandler handler;
  @Getter
  private Status status = Status.CONNECTED;

  @Override
  public void sendPacket(Packet packet) {
    handler.send(packet);
  }

  @Override
  public void disconnect() {
    handler.disconnect();
    status = Status.DISCONNECTED_BY_SERVER;
  }
}
