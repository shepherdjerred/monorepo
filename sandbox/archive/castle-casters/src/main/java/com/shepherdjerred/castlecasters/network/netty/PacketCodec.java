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
    if (packetAsByteBuf.readableBytes() < 4) return;
    packetAsByteBuf.markReaderIndex();
    int length = packetAsByteBuf.readInt();
    if (length < 1 || length > 1_048_576) throw new io.netty.handler.codec.CorruptedFrameException("Invalid packet length");
    if (packetAsByteBuf.readableBytes() < length) { packetAsByteBuf.resetReaderIndex(); return; }
    byte[] readBytes = new byte[length];
    packetAsByteBuf.readBytes(readBytes);
    var packet = serializer.fromBytes(readBytes);
    out.add(packet);
  }
}
