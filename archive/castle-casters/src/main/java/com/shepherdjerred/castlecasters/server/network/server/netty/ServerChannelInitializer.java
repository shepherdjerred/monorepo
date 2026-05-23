package com.shepherdjerred.castlecasters.server.network.server.netty;

import com.shepherdjerred.castlecasters.network.netty.PacketCodec;
import com.shepherdjerred.castlecasters.network.netty.handlers.ExceptionLoggerHandler;
import com.shepherdjerred.castlecasters.network.packet.serialization.PacketJsonSerializer;
import com.shepherdjerred.castlecasters.server.network.event.events.NetworkEvent;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import io.netty.handler.logging.LoggingHandler;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.concurrent.ConcurrentLinkedQueue;

@Log4j2
@AllArgsConstructor
public class ServerChannelInitializer extends ChannelInitializer<SocketChannel> {

  private final ConcurrentLinkedQueue<NetworkEvent> eventQueue;

  @Override
  protected void initChannel(SocketChannel socketChannel) {
    var pipeline = socketChannel.pipeline();
    var serializer = new PacketJsonSerializer();

    pipeline.addLast(new LengthFieldBasedFrameDecoder(65535, 0, 4));
    pipeline.addLast(new PacketCodec(serializer));
    pipeline.addLast(new ServerChannelHandler(eventQueue));
    pipeline.addLast(new LoggingHandler());
    pipeline.addLast(new ExceptionLoggerHandler());
  }
}
