package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Read-only accepted loading boundary, called before any native model session is allocated. */
public final class PromotionBundle {
  private PromotionBundle() {}

  public static void validate(Path directory, JsonNode manifest) {
    try {
      var proofFile = PromotionFiles.regular(directory, "promotion.json");
      var proofBytes = Files.readAllBytes(proofFile);
      var proofHash = ActorManifest.sha256(proofBytes);
      expect(manifest, "promotion_sha256", proofHash);
      var proof = PromotionContract.JSON.readValue(proofBytes, PromotionProof.class);
      PromotionGates.validate(proof);
      PromotionFiles.digest(proof.actor_sha256());
      PromotionFiles.digest(proof.source_manifest_sha256());
      PromotionFiles.digest(proof.native_sha256());
      var sourceFile = PromotionFiles.regular(directory, "source-manifest.json");
      var sourceBytes = Files.readAllBytes(sourceFile);
      PromotionGates.require(
          ActorManifest.sha256(sourceBytes).equals(proof.source_manifest_sha256()),
          "original export checksum");
      var source = PromotionContract.JSON.readTree(sourceBytes);
      source(manifest, source, proof);
      var files = new PromotionFiles(directory, proof);
      PromotionEvidence.validate(files, proof, source);
      files.recheck();
      PromotionGates.require(
          PromotionFiles.hash(proofFile).equals(proofHash)
              && PromotionFiles.hash(sourceFile).equals(proof.source_manifest_sha256()),
          "bundle changed during validation");
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static void source(JsonNode manifest, JsonNode source, PromotionProof proof) {
    ActorManifest.validate(source, ActorManifest.Acceptance.UNACCEPTED_DIAGNOSTIC);
    var original = (ObjectNode) manifest.deepCopy();
    original.remove("promotion_sha256");
    original.put("acceptance", "unaccepted");
    PromotionGates.require(
        original.equals(source), "accepted manifest differs from evaluated export");
    expect(source, "onnx_sha256", proof.actor_sha256());
    expect(source, "checkpoint_manifest_sha256", proof.checkpoint_manifest_sha256());
    expect(source, "weights_sha256", proof.weights_sha256());
    expect(source.path("training"), "dataset_sha256", proof.dataset_sha256());
    expect(source.path("training"), "seed", proof.pilot().seeds().getFirst().seed());
  }

  static void expect(JsonNode node, String name, Object expected) {
    PromotionGates.require(
        equivalent(node.path(name), PromotionContract.JSON.valueToTree(expected)),
        "evidence field " + name);
  }

  private static boolean equivalent(JsonNode actual, JsonNode expected) {
    if (actual.isNumber() && expected.isNumber())
      return actual.asDecimal().compareTo(expected.asDecimal()) == 0;
    if (actual.isObject() && expected.isObject()) return objects(actual, expected);
    if (actual.isArray() && expected.isArray()) return arrays(actual, expected);
    return actual.equals(expected);
  }

  private static boolean objects(JsonNode actual, JsonNode expected) {
    if (!java.util.Set.copyOf(actual.propertyNames())
        .equals(java.util.Set.copyOf(expected.propertyNames()))) return false;
    for (var entry : expected.properties())
      if (!equivalent(actual.path(entry.getKey()), entry.getValue())) return false;
    return true;
  }

  private static boolean arrays(JsonNode actual, JsonNode expected) {
    if (actual.size() != expected.size()) return false;
    for (int index = 0; index < actual.size(); index++)
      if (!equivalent(actual.get(index), expected.get(index))) return false;
    return true;
  }
}
