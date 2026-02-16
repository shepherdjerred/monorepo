package com.shepherdjerred.castlecasters.tui.view;

import com.shepherdjerred.castlecasters.ai.IdealWeights;
import com.shepherdjerred.castlecasters.ai.evaluator.EvaluatorWeights;
import com.shepherdjerred.castlecasters.ai.genetic.WeightsProblem;
import io.jenetics.DoubleChromosome;
import io.jenetics.DoubleGene;
import io.jenetics.Genotype;
import io.jenetics.engine.Engine;
import io.jenetics.engine.EvolutionResult;
import io.jenetics.engine.EvolutionStatistics;
import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Collections;
import java.util.Optional;
import java.util.Scanner;

@Log4j2
@AllArgsConstructor
public class GeneticAiView implements View {

  private final Scanner scanner;

  @Override
  public Optional<View> display() {
    var problem = new WeightsProblem();

    final Engine<DoubleGene, Integer> engine = Engine
        .builder(problem)
        .build();

    final EvolutionStatistics<Integer, ?> statistics = EvolutionStatistics.ofNumber();

    // create the initial population using the IdealWeights
    final Genotype<DoubleGene> initialGenotype = Genotype.of(DoubleChromosome.of(
        DoubleGene.of(IdealWeights.getIdealWeights().adjacentPawnsWeight(), -10000, 10000),
        DoubleGene.of(IdealWeights.getIdealWeights().opponentsShortestPathWeight(), -10000, 10000),
        DoubleGene.of(IdealWeights.getIdealWeights().remainingWallsWeight(), -10000, 10000),
        DoubleGene.of(IdealWeights.getIdealWeights().shortestPathWeight(), -10000, 10000),
        DoubleGene.of(IdealWeights.getIdealWeights().wallsNearbyWeight(), -10000, 10000)
    ));

    final Genotype<DoubleGene> gt = engine.stream(Collections.singleton(initialGenotype))
        .limit(1000)
        .peek(statistics)
        .peek(result -> {
          var weights = problem.codec()
              .decoder()
              .apply(result.getBestPhenotype().getGenotype());
          log.info(weights);
        })
        .peek(r -> {
          log.info(statistics);
        })
        .collect(EvolutionResult.toBestGenotype());

    final EvaluatorWeights param = problem.decode(gt);
    System.out.printf("Result: \t%s%n", param);
    log.info("== Result ==\n{}", param);

    return Optional.of(new MainMenuView(scanner));
  }
}
