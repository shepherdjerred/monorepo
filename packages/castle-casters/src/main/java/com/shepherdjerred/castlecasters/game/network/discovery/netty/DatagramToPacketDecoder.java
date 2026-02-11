package com.shepherdjerred.castlecasters.game.network.discovery.netty;

import com.shepherdjerred.castlecasters.game.network.discovery.ServerInformation;
import com.shepherdjerred.castlecasters.network.packet.packets.ServerBroadcastPacket;
import com.shepherdjerred.castlecasters.network.packet.serialization.PacketJsonSerializer;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.socket.DatagramPacket;
import io.netty.handler.codec.MessageToMessageDecoder;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.List;

@Log4j2
@AllArgsConstructor
public class DatagramToPacketDecoder extends MessageToMessageDecoder<DatagramPacket> {

  private final PacketJsonSerializer serializer;

  @Override
  protected void decode(ChannelHandlerContext ctx, DatagramPacket msg, List<Object> out) {
    var bytes = new byte[msg.content().readableBytes()];
    msg.content().readBytes(bytes);
    var packet = serializer.fromBytes(bytes);
    var broadcastPacket = (ServerBroadcastPacket) packet;
    var info = new ServerInformation(msg.sender(), broadcastPacket.lobby());
    out.add(info);
  }
}
