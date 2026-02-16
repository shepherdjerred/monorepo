package com.shepherdjerred.castlecasters.game.network.discovery.netty;

import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioDatagramChannel;
import io.netty.util.concurrent.DefaultThreadFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.net.InetSocketAddress;
import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
@RequiredArgsConstructor
public class NettyDiscoveryBootstrap implements Runnable {

  private final InetSocketAddress address;
  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue;
  private EventLoopGroup eventLoopGroup;

  @Override
  public void run() {
    eventLoopGroup = new NioEventLoopGroup(2,
        new DefaultThreadFactory("DISCOVERY_THREAD_POOL"));

    try {
      var bootstrap = new Bootstrap();
      bootstrap.group(eventLoopGroup)
          .channel(NioDatagramChannel.class)
          .handler(new DiscoveryChannelInitializer(eventQueue))
          .option(ChannelOption.SO_BROADCAST, true)
          .option(ChannelOption.SO_REUSEADDR, true);

      var channel = bootstrap.bind(address).sync().channel();
      channel.closeFuture().sync();
    } catch (InterruptedException e) {
      log.error(e);
    } finally {
      cleanup();
    }
  }

  public void cleanup() {
    eventLoopGroup.shutdownGracefully().syncUninterruptibly();
  }
}
