package com.shepherdjerred.castlecasters.ai.evaluator;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.player.QuoridorPlayer;

public interface MatchEvaluator {

  double MAX_SCORE = 1_000_000.;
  double MIN_SCORE = -1_000_000.;

  double evaluateMatch(Match match, QuoridorPlayer playerId);
}
