package com.shepherdjerred.castlecasters.server;

import com.shepherdjerred.castlecasters.common.Constants;
import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.common.chat.ChatHistory;
import com.shepherdjerred.castlecasters.common.lobby.Lobby;

import java.net.InetSocketAddress;

public class Main {

  public static void main(String[] args) {
    var gameState = new GameState(Lobby.fromDefaultLobbySettings("Test Lobby"),
        null,
        new ChatHistory());

    var server = new GameServer(gameState, new InetSocketAddress(Constants.GAME_PORT),
        new InetSocketAddress(Constants.DISCOVERY_PORT));
    server.run();
  }
}
