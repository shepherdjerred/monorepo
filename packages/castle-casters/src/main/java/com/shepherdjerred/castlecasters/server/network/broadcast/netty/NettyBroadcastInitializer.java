package com.shepherdjerred.castlecasters.server.network.broadcast.netty;

import com.shepherdjerred.castlecasters.network.netty.handlers.ExceptionLoggerHandler;
import com.shepherdjerred.castlecasters.network.packet.serialization.PacketJsonSerializer;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.socket.nio.NioDatagramChannel;
import io.netty.handler.codec.LengthFieldBasedFrameDecoder;
import io.netty.handler.logging.LoggingHandler;
import lombok.AllArgsConstructor;

import java.net.InetSocketAddress;

import static com.shepherdjerred.castlecasters.common.Constants.DISCOVERY_PORT;

@AllArgsConstructor
public class NettyBroadcastInitializer extends ChannelInitializer<NioDatagramChannel> {

  @Override
  protected void initChannel(NioDatagramChannel datagramChannel) {
    var pipeline = datagramChannel.pipeline();
    var serializer = new PacketJsonSerializer();

    pipeline.addLast(new LengthFieldBasedFrameDecoder(65535, 0, 4));
    pipeline.addLast(new BroadcastPacketEncoder(new InetSocketAddress("255.255.255.255",
        DISCOVERY_PORT), serializer));
    pipeline.addLast(new LoggingHandler());
    pipeline.addLast(new ExceptionLoggerHandler());
  }
}
