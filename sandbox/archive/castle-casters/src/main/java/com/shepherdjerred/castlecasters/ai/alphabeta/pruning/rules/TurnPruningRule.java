package com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules;

import com.shepherdjerred.castlecasters.logic.turn.Turn;

public interface TurnPruningRule {

  boolean shouldPrune(Turn turn);
}
