package com.shepherdjerred.castlecasters.ai.evaluator.rules;


import com.shepherdjerred.castlecasters.ai.evaluator.MatchEvaluator;
import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.board.Coordinate;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.NormalMovePawnTurn;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class VictoryEvaluationRuleTest {

  @Test
  public void evaluate_returnsMaxScore_whenPlayerHasWon() {
    var match = Match.from(new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        new BoardSettings(9, PlayerCount.TWO));
    match = match.doTurnUnchecked(new NormalMovePawnTurn(QuoridorPlayer.ONE, null, new Coordinate(10, 16)));

    System.out.println(match.board().getPawnLocations());
    System.out.println(match.matchStatus());

    var rule = new VictoryEvaluatorRule();

    var actual = rule.evaluate(match, QuoridorPlayer.ONE);
    var expected = MatchEvaluator.MAX_SCORE;

    Assertions.assertEquals(expected, actual, 0);
  }
}
