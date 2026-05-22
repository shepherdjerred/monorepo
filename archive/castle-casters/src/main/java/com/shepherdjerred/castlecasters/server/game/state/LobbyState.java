package com.shepherdjerred.castlecasters.server.game.state;

import com.shepherdjerred.castlecasters.common.player.HumanPlayer;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.server.event.*;
import com.shepherdjerred.castlecasters.server.game.GameLogic;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class LobbyState extends AbstractGameServerState {

  public LobbyState(GameLogic gameLogic,
                    EventBus<Event> eventBus) {
    super(gameLogic, eventBus);
  }

  @Override
  protected EventHandlerFrame<Event> createEventHandlerFrame() {
    var frame = new EventHandlerFrame<>();

    frame.registerHandler(PlayerInformationReceivedEvent.class, (event) -> {
      log.info("PLAYER IS JOINING");

      var lobby = gameLogic.getGameState().lobby();

      if (lobby.isFull()) {
        // TODO Send a message saying the server is full
        event.connection().sendPacket(null);
        event.connection().disconnect();
      }

      var element = lobby.getFreeElement();

      if (element.isEmpty()) {
        throw new IllegalStateException("No free element");
      }

      var playerInformation = event.playerInformation();
      var player = new HumanPlayer(playerInformation.uuid(),
          playerInformation.name(),
          element.get());

      lobby = lobby.addPlayer(player);

      gameLogic.setGameState(gameLogic.getGameState().setLobby(lobby));

      eventBus.dispatch(new PlayerJoinEvent(player, event.connection()));
    });

    frame.registerHandler(FillSlotsWithAiEvent.class, (event) -> {
      var lobby = gameLogic.getGameState().lobby();

      log.info("Filling slots..");

      var player = lobby.createAiPlayer();
      eventBus.dispatch(new PlayerJoinEvent(player, null));
      lobby = lobby.setPlayer(player, QuoridorPlayer.TWO);
      log.info("Added player");

      gameLogic.setGameState(gameLogic.getGameState().setLobby(lobby));
    });

    frame.registerHandler(StartGameEvent.class, (event) -> {
      var currentGameState = gameLogic.getGameState();
      var lobbySettings = currentGameState.lobby().getLobbySettings();
      var matchSettings = lobbySettings.matchSettings();
      var map = lobbySettings.gameMap();
      var boardSettings = new BoardSettings(map.getBoardSize(), matchSettings.playerCount());
      var match = Match.from(matchSettings, boardSettings);

      var newGameState = currentGameState.setMatch(match);

      gameLogic.setGameState(newGameState);

      gameLogic.transitionState(new MatchServerState(gameLogic, eventBus));

      eventBus.dispatch(new MatchStartedEvent());
    });

    return frame;
  }
}
