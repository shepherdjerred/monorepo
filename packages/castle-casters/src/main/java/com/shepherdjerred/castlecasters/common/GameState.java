package com.shepherdjerred.castlecasters.common;

import com.shepherdjerred.castlecasters.common.chat.ChatHistory;
import com.shepherdjerred.castlecasters.common.lobby.Lobby;
import com.shepherdjerred.castlecasters.logic.match.Match;

public record GameState(Lobby lobby, Match match, ChatHistory chatHistory) {

  public GameState setLobby(Lobby lobby) {
    return new GameState(lobby, match, chatHistory);
  }

  public GameState setMatch(Match match) {
    return new GameState(lobby, match, chatHistory);
  }

  public GameState setChatHistory(ChatHistory chatHistory) {
    return new GameState(lobby, match, chatHistory);
  }
}
