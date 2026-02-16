package com.shepherdjerred.castlecasters.logic.turn.generator;


import com.shepherdjerred.castlecasters.logic.board.BoardSettings;
import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchSettings;
import com.shepherdjerred.castlecasters.logic.player.PlayerCount;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import com.shepherdjerred.castlecasters.logic.turn.validator.TurnValidatorFactory;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

public class TurnGeneratorTest {

  @Test
  public void generateValidTurns_returns129_onInitialMatchStateWithStandardBoard() {
    var match = Match.from(new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        new BoardSettings(9, PlayerCount.TWO));
    var generator = new TurnGenerator(new TurnValidatorFactory());

    Assertions.assertEquals(131, generator.generateValidTurns(match).size());
  }

  @Test
  public void generateInvalidTurns_returns1_onInitialMatchStateWithStandardBoard() {
    var match = Match.from(new MatchSettings(10, QuoridorPlayer.ONE, PlayerCount.TWO),
        new BoardSettings(9, PlayerCount.TWO));
    var generator = new TurnGenerator(new TurnValidatorFactory());

    Assertions.assertEquals(1, generator.generateInvalidTurns(match).size());
  }
}
