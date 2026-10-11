package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorParity;
import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorParityEvidence;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Accepted loading validation and offline sealing, with bundle checks before native allocation. */
public final class PromotionBundle {
  private PromotionBundle() {}

  public record Sealed(
      int schema,
      String kind,
      String acceptance,
      String actor_sha256,
      String source_manifest_sha256,
      String manifest_sha256,
      String promotion_sha256,
      ActorParity.Result java_parity,
      boolean learned_control_enabled) {}

  /** Offline producer boundary: no accepted manifest exists until every gate and replay passes. */
  public static Sealed seal(Path directory, Path sourceDirectory) {
    try {
      if (Files.exists(directory.resolve("manifest.json")))
        throw new IllegalArgumentException("promotion manifest already exists");
      var sourceBytes =
          Files.readAllBytes(PromotionFiles.regular(directory, "source-manifest.json"));
      var proofBytes = Files.readAllBytes(PromotionFiles.regular(directory, "promotion.json"));
      var proof = PromotionContract.JSON.readValue(proofBytes, PromotionProof.class);
      var manifest = (ObjectNode) PromotionContract.JSON.readTree(sourceBytes);
      var proofHash = ActorManifest.sha256(proofBytes);
      manifest.put("acceptance", "accepted").put("promotion_sha256", proofHash);
      ActorManifest.validate(manifest, ActorManifest.Acceptance.ACCEPTED);
      validate(directory, manifest);
      sourceFiles(directory, sourceDirectory, proof);
      var samples =
          PromotionFiles.regular(
              directory, "evidence/" + proof.parity().samples_sha256() + ".blob");
      var receipt =
          PromotionFiles.regular(
              directory, "evidence/" + proof.parity().receipt_sha256() + ".blob");
      var replay = ActorParityEvidence.verify(sourceDirectory, samples, receipt);
      sourceFiles(directory, sourceDirectory, proof);
      validate(directory, manifest);
      var bytes =
          (PromotionContract.JSON.writeValueAsString(manifest) + "\n")
              .getBytes(StandardCharsets.UTF_8);
      write(directory.resolve("manifest.json"), bytes);
      return new Sealed(
          1,
          "rwf-actor-promotion-result",
          "accepted",
          proof.actor_sha256(),
          proof.source_manifest_sha256(),
          ActorManifest.sha256(bytes),
          proofHash,
          replay,
          false);
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static void sourceFiles(Path directory, Path sourceDirectory, PromotionProof proof)
      throws IOException {
    PromotionGates.require(
        PromotionFiles.hash(PromotionFiles.regular(directory, "actor.onnx"))
            .equals(proof.actor_sha256()),
        "bundled actor checksum");
    PromotionGates.require(
        PromotionFiles.hash(PromotionFiles.regular(sourceDirectory, "actor.onnx"))
                .equals(proof.actor_sha256())
            && PromotionFiles.hash(PromotionFiles.regular(sourceDirectory, "manifest.json"))
                .equals(proof.source_manifest_sha256()),
        "original actor changed during sealing");
  }

  private static void write(Path target, byte[] bytes) throws IOException {
    try (var output =
        FileChannel.open(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
      var buffer = ByteBuffer.wrap(bytes);
      while (buffer.hasRemaining()) output.write(buffer);
      output.force(true);
    }
  }

  public static void main(String[] args) {
    if (args.length != 2)
      throw new IllegalArgumentException(
          "ActorPromotion <bundle directory> <original unaccepted export>");
    var directory = Path.of(args[0]);
    var result = seal(directory, Path.of(args[1]));
    var text = PromotionContract.JSON.writeValueAsString(result) + "\n";
    try {
      write(directory.resolve("promotion-result.json"), text.getBytes(StandardCharsets.UTF_8));
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
    System.out.print(text);
  }

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
