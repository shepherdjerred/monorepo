package com.shepherdjerred.castlecasters.game.network.client.netty;

import com.shepherdjerred.castlecasters.game.network.event.NetworkEvent;
import com.shepherdjerred.castlecasters.network.netty.PacketCodec;
import com.shepherdjerred.castlecasters.network.netty.handlers.ExceptionLoggerHandler;
import com.shepherdjerred.castlecasters.network.packet.serialization.PacketJsonSerializer;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.socket.nio.NioSocketChannel;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import io.netty.handler.logging.LoggingHandler;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
@AllArgsConstructor
public class NettyClientInitializer extends ChannelInitializer<NioSocketChannel> {

  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue;

  @Override
  protected void initChannel(NioSocketChannel channel) {
    var pipeline = channel.pipeline();
    var serializer = new PacketJsonSerializer();

    pipeline.addLast(new LengthFieldBasedFrameDecoder(65535, 0, 4));
    pipeline.addLast(new PacketCodec(serializer));
    pipeline.addLast(new NettyClientHandler(eventQueue));
    pipeline.addLast(new LoggingHandler());
    pipeline.addLast(new ExceptionLoggerHandler());
  }
}
