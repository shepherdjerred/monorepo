package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/**
 * Portable, content-addressed evidence; neither training-machine paths nor symlinks are followed.
 */
final class PromotionFiles {
  private final Path directory;
  private final Map<String, Path> files;

  PromotionFiles(Path directory, PromotionProof proof) throws IOException {
    this.directory = directory;
    files = new HashMap<>();
    for (var file : proof.files()) {
      digest(file.sha256());
      PromotionGates.require(
          file.file().equals("evidence/" + file.sha256() + ".blob"), "canonical evidence path");
      var resolved = regular(directory, file.file());
      PromotionGates.require(hash(resolved).equals(file.sha256()), "evidence checksum");
      PromotionGates.require(
          files.put(file.sha256(), resolved) == null, "unique evidence catalogue");
    }
    references(PromotionContract.JSON.valueToTree(proof));
  }

  private void references(JsonNode node) {
    if (node.isArray()) {
      for (var child : node) references(child);
    } else if (node.isObject()) {
      for (var entry : node.properties()) {
        var name = entry.getKey();
        if (name.endsWith("_sha256")
            && !name.equals("promotion_contract_sha256")
            && !name.equals("actor_sha256")
            && !name.equals("source_manifest_sha256")
            && !name.equals("native_sha256")) path(entry.getValue().asString());
        else references(entry.getValue());
      }
    }
  }

  Path path(String digest) {
    digest(digest);
    var file = files.get(digest);
    PromotionGates.require(file != null, "missing evidence " + digest);
    return java.util.Objects.requireNonNull(file);
  }

  JsonNode json(String digest) throws IOException {
    return PromotionContract.JSON.readTree(Files.readAllBytes(path(digest)));
  }

  void recheck() throws IOException {
    for (var entry : files.entrySet()) {
      var relative = "evidence/" + entry.getKey() + ".blob";
      PromotionGates.require(
          hash(regular(directory, relative)).equals(entry.getKey()),
          "evidence changed during validation");
    }
  }

  static void digest(String value) {
    PromotionGates.require(value != null && value.matches("[a-f0-9]{64}"), "SHA-256 format");
  }

  static Path regular(Path directory, String relative) {
    var resolved = directory;
    for (var component : Path.of(relative)) {
      resolved = resolved.resolve(component);
      PromotionGates.require(!Files.isSymbolicLink(resolved), "evidence symlink");
    }
    PromotionGates.require(
        Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS),
        "missing bundle file " + relative);
    return resolved;
  }

  static String hash(Path file) throws IOException {
    try {
      var digest = MessageDigest.getInstance("SHA-256");
      try (var input = Files.newInputStream(file)) {
        var bytes = new byte[64 * 1024];
        for (int count = input.read(bytes); count != -1; count = input.read(bytes))
          digest.update(bytes, 0, count);
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException failure) {
      throw new IllegalStateException(failure);
    }
  }
}
