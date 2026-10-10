package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import com.shepherdjerred.thestorm.rwfbots.adapter.content.LearningContract;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Exact exported model contract; unknown metadata and corrupt artifact hashes fail loudly. */
public final class ActorManifest {
  public enum Acceptance {
    ACCEPTED,
    UNACCEPTED_DIAGNOSTIC
  }

  private static final JsonMapper JSON = JsonMapper.builder().build();
  private static final Set<String> FIELDS =
      Set.of(
          "schema",
          "kind",
          "acceptance",
          "contract",
          "contract_sha256",
          "features",
          "heads",
          "hidden",
          "tick_hz",
          "weights_sha256",
          "training",
          "onnx_sha256",
          "opset",
          "inputs",
          "outputs",
          "parity",
          "checkpoint_manifest_sha256");

  private ActorManifest() {}

  public static byte[] load(Path directory, Acceptance acceptance) {
    try {
      var manifest = JSON.readTree(Files.readString(directory.resolve("manifest.json")));
      validate(manifest, acceptance);
      if (acceptance == Acceptance.ACCEPTED) PromotionBundle.validate(directory, manifest);
      var model = Files.readAllBytes(directory.resolve("actor.onnx"));
      if (!sha256(model).equals(manifest.path("onnx_sha256").asString()))
        throw new IllegalArgumentException("ONNX artifact hash mismatch");
      return model;
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  public static void validate(JsonNode manifest, Acceptance acceptance) {
    var fields = new java.util.HashSet<>(FIELDS);
    if (acceptance == Acceptance.ACCEPTED) fields.add("promotion_sha256");
    if (!manifest.isObject() || !Set.copyOf(manifest.propertyNames()).equals(fields))
      throw new IllegalArgumentException("unknown or missing actor manifest fields");
    expect(manifest, "schema", 1);
    expect(manifest, "kind", "rwf-trooper-ppo");
    expect(manifest, "acceptance", acceptance == Acceptance.ACCEPTED ? "accepted" : "unaccepted");
    expect(manifest, "contract", "rwf-combat-v1");
    expect(manifest, "hidden", 128);
    expect(manifest, "tick_hz", 20);
    expect(manifest, "opset", 18);
    expect(manifest, "inputs", List.of("observation", "hidden", "cell"));
    expect(manifest, "outputs", List.of("logits", "next_hidden", "next_cell"));
    var features =
        LearningContract.load().fields().stream().map(field -> field.feature().name()).toList();
    expect(manifest, "features", features);
    expect(
        manifest,
        "heads",
        java.util.Map.of("move", 9, "jump", 2, "sneak", 2, "sprint", 2, "attack", 2));
    for (var name :
        List.of("weights_sha256", "contract_sha256", "onnx_sha256", "checkpoint_manifest_sha256")) {
      if (!manifest.path(name).isString()
          || !manifest.path(name).asString().matches("[a-f0-9]{64}"))
        throw new IllegalArgumentException("invalid actor digest " + name);
    }
    validateContractHash(manifest);
    validateParity(manifest.path("parity"));
    if (!manifest.path("training").isObject())
      throw new IllegalArgumentException("missing actor training provenance");
    if (acceptance == Acceptance.ACCEPTED) {
      if (!manifest.path("promotion_sha256").isString()
          || !manifest.path("promotion_sha256").asString().matches("[a-f0-9]{64}"))
        throw new IllegalArgumentException("accepted actor lacks a promotion bundle fingerprint");
      validateAcceptedTraining(manifest.path("training"));
    }
  }

  private static void validateAcceptedTraining(JsonNode training) {
    expect(training, "provenance", "human-bc-plus-paper-ppo");
    expect(training, "test_used_for_selection", false);
    expect(training, "pilot_acceptance_checked", false);
    expect(training.path("curriculum"), "complete", true);
    if (!training.path("dataset_sha256").isString()
        || !training.path("dataset_sha256").asString().matches("[a-f0-9]{64}"))
      throw new IllegalArgumentException("accepted actor lacks a genuine dataset fingerprint");
  }

  private static void validateParity(JsonNode parity) {
    if (!parity.isObject()
        || !Set.copyOf(parity.propertyNames())
            .equals(Set.of("backend", "max_abs_error", "batches", "steps")))
      throw new IllegalArgumentException("invalid export parity metadata");
    expect(parity, "backend", "onnxruntime-cpu");
    expect(parity, "batches", List.of(1, 3, 20, 100));
    expect(parity, "steps", 16);
    var error = parity.path("max_abs_error");
    if (!error.isNumber() || !Double.isFinite(error.asDouble()) || error.asDouble() < 0)
      throw new IllegalArgumentException("invalid export parity error");
  }

  private static void validateContractHash(JsonNode manifest) {
    var stream = ActorManifest.class.getResourceAsStream("/rwf-combat-v1.tsv");
    if (stream == null) throw new IllegalStateException("missing actor observation contract");
    try (stream) {
      expect(manifest, "contract_sha256", sha256(stream.readAllBytes()));
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static void expect(JsonNode node, String name, Object expected) {
    if (!node.path(name).equals(JSON.valueToTree(expected)))
      throw new IllegalArgumentException("actor contract mismatch: " + name);
  }

  public static String sha256(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException(failure);
    }
  }
}
