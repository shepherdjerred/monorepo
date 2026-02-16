package com.shepherdjerred.castlecasters.server.game;

import com.shepherdjerred.castlecasters.common.GameState;
import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.server.game.state.GameServerState;
import com.shepherdjerred.castlecasters.server.game.state.PreLobbyState;
import lombok.Getter;
import lombok.Setter;

public class GameLogic {

  @Setter
  private Player host = null;
  @Getter
  @Setter
  private GameState gameState;
  private GameServerState gameServerState;

  public GameLogic(GameState gameState, EventBus<Event> eventBus) {
    this.gameServerState = new PreLobbyState(this, eventBus);
    this.gameState = gameState;
    gameServerState.enable();
  }

  public boolean hasHost() {
    return host != null;
  }

  public void transitionState(GameServerState newState) {
    gameServerState.disable();
    newState.enable();
    gameServerState = newState;
  }
}
