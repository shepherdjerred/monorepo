package com.shepherdjerred.castlecasters.game.network.discovery.netty;

import com.shepherdjerred.castlecasters.game.network.discovery.ServerInformation;
import com.shepherdjerred.castlecasters.game.network.discovery.event.ServerDiscoveredEvent;
import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
@AllArgsConstructor
public class DiscoveryChannelInboundHandler extends ChannelInboundHandlerAdapter {

  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue;

  @Override
  public void channelRead(ChannelHandlerContext context, Object message) {
    if (message instanceof ServerInformation serverInformation) {
      var serverDiscoveredEvent = new ServerDiscoveredEvent(serverInformation);

      eventQueue.add(serverDiscoveredEvent);
    } else {
      log.info("Received unknown data.");
    }
  }
}
