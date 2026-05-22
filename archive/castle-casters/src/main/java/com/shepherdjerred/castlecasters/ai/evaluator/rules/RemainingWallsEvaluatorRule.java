package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.ToString;

@ToString
public class RemainingWallsEvaluatorRule implements EvaluatorRule {

  @Override
  public double evaluate(Match match, QuoridorPlayer player) {
    return match.getWallsLeft(player);
  }
}
