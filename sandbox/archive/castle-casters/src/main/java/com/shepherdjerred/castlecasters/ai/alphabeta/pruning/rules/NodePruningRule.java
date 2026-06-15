package com.shepherdjerred.castlecasters.ai.alphabeta.pruning.rules;

import com.shepherdjerred.castlecasters.ai.alphabeta.pruning.PruningQuoridorNode;

public interface NodePruningRule {

  boolean shouldPrune(PruningQuoridorNode node);
}
