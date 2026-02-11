package com.shepherdjerred.castlecasters.server.game.state;

import com.shepherdjerred.castlecasters.ai.alphabeta.AlphaBetaQuoridorAi;
import com.shepherdjerred.castlecasters.ai.evaluator.EvaluatorWeights;
import com.shepherdjerred.castlecasters.ai.evaluator.WeightedMatchEvaluator;
import com.shepherdjerred.castlecasters.common.player.AiPlayer;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.server.event.DoAiTurnEvent;
import com.shepherdjerred.castlecasters.server.event.DoTurnEvent;
import com.shepherdjerred.castlecasters.server.event.MatchStartedEvent;
import com.shepherdjerred.castlecasters.server.event.TryDoTurnEvent;
import com.shepherdjerred.castlecasters.server.game.GameLogic;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class MatchServerState extends AbstractGameServerState {

  public MatchServerState(GameLogic gameLogic,
                          EventBus<Event> eventBus) {
    super(gameLogic, eventBus);
  }

  @Override
  protected EventHandlerFrame<Event> createEventHandlerFrame() {
    var frame = new EventHandlerFrame<>();

    frame.registerHandler(MatchStartedEvent.class, (event) -> {
      var gameState = gameLogic.getGameState();
      var match = gameState.match();
      var nextPlayerId = match.getActivePlayerId();
      var nextPlayer = gameState.lobby().getPlayer(nextPlayerId);

      log.info(gameState.lobby());
      log.info(nextPlayer);
    });

    frame.registerHandler(DoAiTurnEvent.class, (event) -> {
      var gameState = gameLogic.getGameState();

      var match = gameState.match();
      var ai = new AlphaBetaQuoridorAi(new WeightedMatchEvaluator(new EvaluatorWeights(
          9612.407041694314,
          -7288.691596308785,
          9786.056427421212,
          2396.69915479313,
          476.91303038346996
      )), 2);

      var turn = ai.calculateBestTurn(match);
      eventBus.dispatch(new TryDoTurnEvent(turn));
    });

    frame.registerHandler(TryDoTurnEvent.class, (event) -> {
      var gameState = gameLogic.getGameState();

      var match = gameState.match();
      var turn = event.turn();

      try {
        var newMatch = match.doTurn(turn);
        var newGameState = gameState.setMatch(newMatch);

        gameLogic.setGameState(newGameState);

        eventBus.dispatch(new DoTurnEvent(turn));

        var nextPlayerId = newMatch.getActivePlayerId();
        var nextPlayer = gameState.lobby().getPlayer(nextPlayerId);

        log.info(gameState.lobby());
        log.info(gameState.match());

        if (nextPlayer instanceof AiPlayer) {
          log.info("Doing AI turn...");
          eventBus.dispatch(new DoAiTurnEvent(nextPlayer));
        } else {
          log.info("Next player is not an AI {}", nextPlayer);
        }
      } catch (Exception e) {
        log.error("Error doing turn", e);
      }
    });

    return frame;
  }
}
