package com.shepherdjerred.castlecasters.ai;

import com.shepherdjerred.castlecasters.logic.match.Match;
import com.shepherdjerred.castlecasters.logic.turn.Turn;

public interface QuoridorAi {
  Turn calculateBestTurn(Match match);
}
