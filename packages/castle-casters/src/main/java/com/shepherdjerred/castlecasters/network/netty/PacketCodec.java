package com.shepherdjerred.castlecasters.network.netty;

import com.shepherdjerred.castlecasters.network.packet.packets.Packet;
import com.shepherdjerred.castlecasters.network.packet.serialization.PacketSerializer;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageCodec;
import lombok.AllArgsConstructor;

import java.util.List;

@AllArgsConstructor
public class PacketCodec extends ByteToMessageCodec<Packet> {

  private final PacketSerializer serializer;

  @Override
  protected void encode(ChannelHandlerContext ctx, Packet packet, ByteBuf out) {
    var packetAsBytes = serializer.toBytes(packet);
    out.writeInt(packetAsBytes.length);
    out.writeBytes(packetAsBytes);
  }

  @Override
  protected void decode(ChannelHandlerContext ctx, ByteBuf packetAsByteBuf, List<Object> out) {
    int numberOfBytes = packetAsByteBuf.readableBytes();
    byte[] readBytes = new byte[numberOfBytes - 4];
    packetAsByteBuf.skipBytes(4);
    packetAsByteBuf.readBytes(readBytes);
    var packet = serializer.fromBytes(readBytes);
    out.add(packet);
  }
}
