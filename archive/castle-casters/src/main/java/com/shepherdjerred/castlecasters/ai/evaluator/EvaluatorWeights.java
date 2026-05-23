package com.shepherdjerred.castlecasters.ai.evaluator;

public record EvaluatorWeights(double adjacentPawnsWeight, double opponentsShortestPathWeight,
                               double remainingWallsWeight, double shortestPathWeight, double wallsNearbyWeight) {
}
