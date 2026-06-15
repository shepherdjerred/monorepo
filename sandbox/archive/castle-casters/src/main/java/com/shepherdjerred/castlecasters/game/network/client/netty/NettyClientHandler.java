package com.shepherdjerred.castlecasters.game.network.client.netty;

import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;
import com.shepherdjerred.castlecasters.game.network.event.PacketReceivedEvent;
import com.shepherdjerred.castlecasters.game.network.event.ServerConnectedEvent;
import com.shepherdjerred.castlecasters.game.network.event.ServerDisconnectedEvent;
import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import io.netty.channel.ChannelDuplexHandler;
import io.netty.channel.ChannelHandlerContext;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
@AllArgsConstructor
public class NettyClientHandler extends ChannelDuplexHandler {

  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue;

  @Override
  public void channelActive(ChannelHandlerContext ctx) {
    eventQueue.add(new ServerConnectedEvent());
  }

  @Override
  public void channelInactive(ChannelHandlerContext ctx) {
    eventQueue.add(new ServerDisconnectedEvent());
  }

  @Override
  public void channelRead(ChannelHandlerContext ctx, Object msg) {
    var packet = (Packet) msg;
    log.info("Received a packet: {}", packet);
    eventQueue.add(new PacketReceivedEvent(packet));
  }
}
