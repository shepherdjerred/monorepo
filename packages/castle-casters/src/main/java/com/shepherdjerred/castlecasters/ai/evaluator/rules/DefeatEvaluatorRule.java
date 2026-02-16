package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.match.MatchStatus.Status;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;

import static com.shepherdjerred.castlecasters.ai.evaluator.MatchEvaluator.MIN_SCORE;

@Log4j2
@ToString
public class DefeatEvaluatorRule implements EvaluatorRule {

  @Override
  public double evaluate(Match match, QuoridorPlayer player) {
    if (match.matchStatus().status() == Status.VICTORY
        && match.matchStatus().victor() != player) {
      return MIN_SCORE;
    } else {
      return 0.0;
    }
  }
}
