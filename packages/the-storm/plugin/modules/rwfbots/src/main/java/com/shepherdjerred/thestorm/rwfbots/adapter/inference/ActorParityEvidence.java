package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.List;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Portable receipt for an exact artifact replay. It does not accept a model. */
public final class ActorParityEvidence {
  static final JsonMapper JSON =
      JsonMapper.builder()
          .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
          .enable(DeserializationFeature.FAIL_ON_NULL_CREATOR_PROPERTIES)
          .build();
  static final Contract CONTRACT = contract();

  private ActorParityEvidence() {}

  public record Contract(
      int version,
      int samplesSchema,
      int receiptSchema,
      String kind,
      List<Integer> batches,
      int steps,
      double rtol,
      double atol,
      List<String> samplesFields) {}

  public record Binding(
      String onnx_sha256,
      String actor_manifest_sha256,
      String checkpoint_manifest_sha256,
      String weights_sha256,
      String contract_sha256,
      String samples_sha256) {}

  public record Receipt(
      int schema,
      String kind,
      String acceptance,
      String backend,
      String parity_contract_sha256,
      Binding artifacts,
      double rtol,
      double atol,
      ActorParity.Result replay) {}

  static Binding binding(Path directory, Path samples) throws IOException {
    var manifest = JSON.readTree(Files.readAllBytes(directory.resolve("manifest.json")));
    ActorManifest.validate(manifest, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC);
    return new Binding(
        ActorManifest.sha256(Files.readAllBytes(directory.resolve("actor.onnx"))),
        ActorManifest.sha256(Files.readAllBytes(directory.resolve("manifest.json"))),
        manifest.path("checkpoint_manifest_sha256").asString(),
        manifest.path("weights_sha256").asString(),
        manifest.path("contract_sha256").asString(),
        ActorManifest.sha256(Files.readAllBytes(samples)));
  }

  public static Receipt write(Path directory, Path samples, Path output) {
    try {
      var before = binding(directory, samples);
      var result = ActorParity.verify(directory, samples);
      if (!before.equals(binding(directory, samples)))
        throw new IllegalArgumentException("parity artifacts changed during replay");
      var receipt =
          new Receipt(
              CONTRACT.receiptSchema(),
              CONTRACT.kind(),
              "unaccepted",
              "onnxruntime-java-cpu",
              ActorManifest.sha256(contractBytes()),
              before,
              CONTRACT.rtol(),
              CONTRACT.atol(),
              result);
      var bytes =
          ByteBuffer.wrap(
              (JSON.writeValueAsString(receipt) + "\n").getBytes(StandardCharsets.UTF_8));
      try (var file =
          FileChannel.open(output, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
        while (bytes.hasRemaining()) file.write(bytes);
        file.force(true);
      }
      return receipt;
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static byte[] contractBytes() {
    var stream = ActorParityEvidence.class.getResourceAsStream("/rwf-actor-parity.json");
    if (stream == null) throw new IllegalStateException("missing actor parity contract");
    try (stream) {
      return stream.readAllBytes();
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static Contract contract() {
    var result = JSON.readValue(contractBytes(), Contract.class);
    var fields =
        Arrays.stream(ActorParity.Samples.class.getRecordComponents())
            .map(java.lang.reflect.RecordComponent::getName)
            .toList();
    if (result.version() != 1
        || result.samplesSchema() != 2
        || result.receiptSchema() != 1
        || !result.kind().equals("rwf-actor-parity")
        || !result.batches().equals(List.of(1, 3, 20, 100))
        || result.steps() != 16
        || result.rtol() != 1e-4
        || result.atol() != 1e-5
        || !result.samplesFields().equals(fields))
      throw new IllegalStateException("unsupported actor parity contract");
    return result;
  }
}
