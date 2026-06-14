package com.shepherdjerred.castlecasters.game.network.client.netty;

import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;
import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.Channel;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.util.concurrent.DefaultThreadFactory;
import lombok.extern.log4j.Log4j2;

import java.net.SocketAddress;
import java.util.Optional;
import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
public class NettyClientBootstrap {

  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue = new ConcurrentLinkedQueue<>();
  private EventLoopGroup eventLoopGroup;
  private Channel channel;

  public void connect(SocketAddress address) {
    eventLoopGroup = new NioEventLoopGroup(2,
        new DefaultThreadFactory("CLIENT_NETWORK_THREAD_POOL"));

    try {
      var bootstrap = new Bootstrap();
      bootstrap.group(eventLoopGroup)
          .channel(NioSocketChannel.class)
          .handler(new NettyClientInitializer(eventQueue))
          .option(ChannelOption.SO_REUSEADDR, true)
          .option(ChannelOption.SO_KEEPALIVE, true);

      channel = bootstrap.connect(address).sync().channel();

      channel.closeFuture().sync();
    } catch (InterruptedException e) {
      log.error(e);
    } finally {
      cleanup();
    }
  }

  public void send(Packet packet) {
    channel.writeAndFlush(packet);
  }

  public void cleanup() {
    eventLoopGroup.shutdownGracefully();
  }

  public Optional<NetworkEvent> getLatestEvent() {
    if (!eventQueue.isEmpty()) {
      return Optional.of(eventQueue.poll());
    } else {
      return Optional.empty();
    }
  }
}
