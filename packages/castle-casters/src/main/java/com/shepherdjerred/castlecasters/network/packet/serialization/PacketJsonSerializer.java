package com.shepherdjerred.castlecasters.network.packet.serialization;

import com.google.common.base.Charsets;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import com.google.gson.typeadapters.RuntimeTypeAdapterFactory;
import com.shepherdjerred.castlecasters.common.player.AiPlayer;
import com.shepherdjerred.castlecasters.common.player.HumanPlayer;
import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.logic.turn.*;
import com.shepherdjerred.castlecasters.network.packet.packets.*;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class PacketJsonSerializer implements PacketSerializer {

  private final Gson gson;

  public PacketJsonSerializer() {
    var packetTypeFactory = RuntimeTypeAdapterFactory.of(Packet.class, "packetType")
        .registerSubtype(ConnectionAcceptedPacket.class)
        .registerSubtype(ConnectionRejectedPacket.class)
        .registerSubtype(PlayerDescriptionPacket.class)
        .registerSubtype(PlayerJoinPacket.class)
        .registerSubtype(ServerBroadcastPacket.class)
        .registerSubtype(StartMatchPacket.class)
        .registerSubtype(DoTurnPacket.class)
        .registerSubtype(FillSlotsWithAiPacket.class);

    var turnTypeFactory = RuntimeTypeAdapterFactory.of(Turn.class, "turnTurn")
        .registerSubtype(NormalMovePawnTurn.class)
        .registerSubtype(JumpPawnDiagonalTurn.class)
        .registerSubtype(JumpPawnStraightTurn.class)
        .registerSubtype(PlaceWallTurn.class);

    var playerTypeFactory = RuntimeTypeAdapterFactory.of(Player.class, "playerType")
        .registerSubtype(HumanPlayer.class)
        .registerSubtype(AiPlayer.class);

    gson = new GsonBuilder()
        .enableComplexMapKeySerialization()
        .registerTypeAdapterFactory(packetTypeFactory)
        .registerTypeAdapterFactory(playerTypeFactory)
        .registerTypeAdapterFactory(turnTypeFactory)
        .create();
  }

  @Override
  public byte[] toBytes(Packet packet) {
    var packetAsJson = gson.toJson(packet, Packet.class);
    return packetAsJson.getBytes(Charsets.UTF_8);
  }

  @Override
  public Packet fromBytes(byte[] packetAsBytes) {
    var packetAsString = new String(packetAsBytes, Charsets.UTF_8);
    return gson.fromJson(packetAsString, new TypeToken<Packet>() {
    }.getType());
  }
}
