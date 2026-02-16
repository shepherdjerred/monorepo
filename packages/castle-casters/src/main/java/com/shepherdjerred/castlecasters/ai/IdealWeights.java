package com.shepherdjerred.castlecasters.ai;

import com.shepherdjerred.castlecasters.ai.evaluator.EvaluatorWeights;

public class IdealWeights {
// EvaluatorWeights[adjacentPawnsWeight=-3090.3220049921583, opponentsShortestPathWeight=-3948.5502805586066, remainingWallsWeight=1537.2902850393293, shortestPathWeight=6545.988764793685, wallsNearbyWeight=3803.330365871887]


  public static EvaluatorWeights getIdealWeights() {
    return new EvaluatorWeights(
        9612.407041694314,
        -7288.691596308785,
        9786.056427421212,
        2396.69915479313,
        476.91303038346996
    );
  }
}
