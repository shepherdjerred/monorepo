package com.shepherdjerred.castlecasters.ai.evaluator.rules;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public interface EvaluatorRule {

  double evaluate(Match match, QuoridorPlayer optimizingPlayer);
}
