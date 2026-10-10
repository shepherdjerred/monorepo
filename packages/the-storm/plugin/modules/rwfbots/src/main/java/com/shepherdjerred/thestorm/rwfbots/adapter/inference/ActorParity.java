package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import com.shepherdjerred.thestorm.rwfbots.app.learning.ActorMatrix;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import tools.jackson.databind.json.JsonMapper;

/** Independent Java recurrent replay of Python expectations; usable without Paper. */
public final class ActorParity {
  private static final JsonMapper JSON = ActorParityEvidence.JSON;

  private ActorParity() {}

  public record Samples(
      int schema,
      String onnx_sha256,
      String actor_manifest_sha256,
      String checkpoint_manifest_sha256,
      String weights_sha256,
      String contract_sha256,
      double rtol,
      double atol,
      List<Case> cases) {}

  public record Case(int rows, List<Step> steps) {}

  public record Step(
      List<List<Double>> observation,
      List<List<Double>> logits,
      List<List<Double>> hidden,
      List<List<Double>> cell) {}

  public record Result(List<Integer> batches, int steps, double maximumAbsoluteError) {}

  public static Result verify(Path directory, Path samplesFile) {
    try {
      var binding = ActorParityEvidence.binding(directory, samplesFile);
      var samples = JSON.readValue(Files.readString(samplesFile), Samples.class);
      var contract = ActorParityEvidence.CONTRACT;
      if (samples.schema() != contract.samplesSchema()
          || samples.rtol() != contract.rtol()
          || samples.atol() != contract.atol()
          || !samples.onnx_sha256().equals(binding.onnx_sha256())
          || !samples.actor_manifest_sha256().equals(binding.actor_manifest_sha256())
          || !samples.checkpoint_manifest_sha256().equals(binding.checkpoint_manifest_sha256())
          || !samples.weights_sha256().equals(binding.weights_sha256())
          || !samples.contract_sha256().equals(binding.contract_sha256()))
        throw new IllegalArgumentException("invalid parity sample contract or model hash");
      var batches = samples.cases().stream().map(Case::rows).toList();
      if (!batches.equals(contract.batches()))
        throw new IllegalArgumentException("incomplete parity batch cases");
      double maximum = 0;
      try (var actor = OnnxActor.load(directory, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC)) {
        for (var sample : samples.cases()) maximum = Math.max(maximum, replay(actor, sample));
      }
      if (!binding.equals(ActorParityEvidence.binding(directory, samplesFile)))
        throw new IllegalArgumentException("parity artifacts changed during replay");
      return new Result(batches, contract.steps(), maximum);
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static double replay(RecurrentActor actor, Case sample) {
    if (sample.steps().size() != 16)
      throw new IllegalArgumentException("incomplete parity recurrent steps");
    var hidden = new ActorMatrix(sample.rows(), 128, new float[sample.rows() * 128]);
    var cell = new ActorMatrix(sample.rows(), 128, new float[sample.rows() * 128]);
    double maximum = 0;
    for (var step : sample.steps()) {
      if (step.observation().size() != sample.rows())
        throw new IllegalArgumentException("parity observation batch size mismatch");
      var output =
          actor.forward(new RecurrentActor.Input(matrix(step.observation(), 34), hidden, cell));
      maximum = Math.max(maximum, compare(output.logits(), matrix(step.logits(), 17)));
      maximum = Math.max(maximum, compare(output.hidden(), matrix(step.hidden(), 128)));
      maximum = Math.max(maximum, compare(output.cell(), matrix(step.cell(), 128)));
      hidden = output.hidden();
      cell = output.cell();
    }
    return maximum;
  }

  private static ActorMatrix matrix(List<List<Double>> rows, int columns) {
    var values = new float[rows.size() * columns];
    for (var index = 0; index < rows.size(); index++) {
      if (rows.get(index).size() != columns)
        throw new IllegalArgumentException("ragged parity tensor");
      for (var column = 0; column < columns; column++)
        values[index * columns + column] = rows.get(index).get(column).floatValue();
    }
    return new ActorMatrix(rows.size(), columns, values);
  }

  private static double compare(ActorMatrix actual, ActorMatrix expected) {
    if (actual.rows() != expected.rows() || actual.columns() != expected.columns())
      throw new IllegalArgumentException("parity output shape mismatch");
    var left = actual.values();
    var right = expected.values();
    double maximum = 0;
    for (var index = 0; index < left.length; index++) {
      double difference = Math.abs(left[index] - right[index]);
      if (difference > 1e-5 + 1e-4 * Math.abs(right[index]))
        throw new IllegalArgumentException("Java/Python recurrent parity failed");
      maximum = Math.max(maximum, difference);
    }
    return maximum;
  }

  public static void main(String[] args) {
    if (args.length != 2 && args.length != 3)
      throw new IllegalArgumentException(
          "ActorParity <onnx directory> <samples.json> [receipt.json]");
    var directory = Path.of(args[0]);
    var samples = Path.of(args[1]);
    var result =
        args.length == 3
            ? ActorParityEvidence.write(directory, samples, Path.of(args[2]))
            : verify(directory, samples);
    System.out.println(JSON.writeValueAsString(result));
  }
}
