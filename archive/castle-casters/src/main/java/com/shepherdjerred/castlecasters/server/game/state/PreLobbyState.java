package com.shepherdjerred.castlecasters.server.game.state;

import com.shepherdjerred.castlecasters.common.lobby.LobbySettings.LobbyType;
import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.common.player.HumanPlayer;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.server.event.FillSlotsWithAiEvent;
import com.shepherdjerred.castlecasters.server.event.PlayerInformationReceivedEvent;
import com.shepherdjerred.castlecasters.server.event.PlayerJoinEvent;
import com.shepherdjerred.castlecasters.server.game.GameLogic;
import com.shepherdjerred.castlecasters.server.network.manager.events.StartBroadcastEvent;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class PreLobbyState extends AbstractGameServerState {

  public PreLobbyState(GameLogic gameLogic,
                       EventBus<Event> eventBus) {
    super(gameLogic, eventBus);
  }

  @Override
  protected EventHandlerFrame<Event> createEventHandlerFrame() {
    var frame = new EventHandlerFrame<>();

    frame.registerHandler(PlayerInformationReceivedEvent.class, event -> {
      var playerInformation = event.playerInformation();
      var player = new HumanPlayer(playerInformation.uuid(),
          playerInformation.name(),
          Element.ICE);

      eventBus.dispatch(new PlayerJoinEvent(player, event.connection()));

      gameLogic.setHost(player);
      gameLogic.transitionState(new LobbyState(gameLogic, eventBus));

      var lobby = gameLogic.getGameState().lobby();
      var lobbyType = lobby.getLobbySettings().lobbyType();

      if (lobbyType == LobbyType.NETWORK) {
        eventBus.dispatch(new StartBroadcastEvent(lobby));
      }
    });

    frame.registerHandler(FillSlotsWithAiEvent.class, (event) -> {
      var lobby = gameLogic.getGameState().lobby();

      log.info("Filling slots...");

      var player = lobby.createAiPlayer();
      eventBus.dispatch(new PlayerJoinEvent(player, null));
      lobby = lobby.setPlayer(player, QuoridorPlayer.TWO);
      log.info("Added player");

      gameLogic.setGameState(gameLogic.getGameState().setLobby(lobby));
    });

    return frame;
  }

}
