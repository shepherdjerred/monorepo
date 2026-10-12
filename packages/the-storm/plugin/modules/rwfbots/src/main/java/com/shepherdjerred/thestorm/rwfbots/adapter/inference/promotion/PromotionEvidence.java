package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle.expect;
import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/** Binds the gate facts to their archived reports and original training ledger. */
final class PromotionEvidence {
  private PromotionEvidence() {}

  static void validate(PromotionFiles files, PromotionProof proof, JsonNode source)
      throws IOException {
    pilot(files, proof, source);
    PromotionStrength.validate(files, proof);
    PromotionPreference.validate(files, proof);
    parity(files, proof, source);
    load(files, proof);
    PromotionLoad.validate(files, proof.load());
    regressions(files, proof);
  }

  private static void pilot(PromotionFiles files, PromotionProof proof, JsonNode source)
      throws IOException {
    var ledger = files.json(proof.pilot().ledger_sha256());
    expect(ledger, "version", 1);
    expect(ledger, "mode", "pilot");
    expect(ledger, "acceptance", "unaccepted");
    expect(ledger, "seconds", PromotionContract.VALUES.seedSeconds());
    expect(ledger, "seeds", proof.pilot().seeds().stream().map(PromotionProof.Seed::seed).toList());
    expect(ledger, "inputSha256", proof.pilot().inputs_sha256());
    var inputs = files.json(proof.pilot().inputs_sha256());
    require(
        nativeHash(inputs.path("native")).equals(proof.native_sha256()), "frozen native runtime");
    nativeFiles(files, inputs.path("native"));
    dataset(files, proof, inputs.path("dataset"));
    var maps = PromotionMaps.catalog(inputs.path("maps"));
    strengthPlan(files, proof, inputs.path("maps"));
    for (var seed : proof.pilot().seeds()) {
      seed(files, proof, seed, source);
      PromotionMaps.training(files.json(seed.checkpoint_manifest_sha256()).path("training"), maps);
    }
  }

  private static void strengthPlan(PromotionFiles files, PromotionProof proof, JsonNode maps)
      throws IOException {
    var plan = files.json(proof.pilot().strength_plan_sha256());
    var claim = files.json(proof.pilot().strength_claim_sha256());
    expect(
        claim,
        "planSha256",
        ActorManifest.sha256(
            PromotionContract.JSON.writeValueAsString(plan).getBytes(StandardCharsets.UTF_8)));
    expect(plan, "version", 2);
    expect(plan, "maps", maps);
    expect(plan, "mode", "pilot");
    expect(plan, "acceptance", "unaccepted");
    expect(plan, "matchesPerOpponent", 200);
    expect(plan, "firstSeed", 500_000_000);
    expect(plan, "retries", 0);
    expect(plan, "optimized", false);
    expect(plan, "pilotAcceptanceChecked", false);
    require(
        nativeHash(plan.path("native")).equals(proof.native_sha256()), "strength native runtime");
    var actors = plan.path("actors");
    require(actors.isArray() && actors.size() == 3, "strength actor inventory");
    for (int index = 0; index < actors.size(); index++) {
      var seed = proof.pilot().seeds().get(index);
      expect(actors.get(index), "seed", seed.seed());
      expect(actors.get(index), "weightsSha256", seed.weights_sha256());
      expect(actors.get(index), "manifestSha256", seed.checkpoint_manifest_sha256());
    }
  }

  static String nativeHash(JsonNode nativeInputs) {
    require(
        nativeInputs.isObject() && nativeInputs.path("hashes").isArray(), "native input inventory");
    var runtime = (ObjectNode) nativeInputs.deepCopy();
    var hashes = PromotionContract.JSON.createArrayNode();
    for (var file : nativeInputs.path("hashes"))
      if (!file.path("file").asString().startsWith("tools/learning/")) hashes.add(file);
    runtime.set("hashes", hashes);
    return ActorManifest.sha256(
        PromotionContract.JSON.writeValueAsString(runtime).getBytes(StandardCharsets.UTF_8));
  }

  private static void nativeFiles(PromotionFiles files, JsonNode nativeInputs) {
    expect(nativeInputs, "engine", "Paper");
    expect(nativeInputs, "controllerHz", 20);
    expect(nativeInputs, "timeoutTicks", 1200);
    var names = new HashSet<String>();
    for (var file : nativeInputs.path("hashes")) {
      require(
          file.path("file").isString() && names.add(file.path("file").asString()),
          "unique native files");
      files.path(file.path("sha256").asString());
    }
    require(!names.isEmpty() && nativeInputs.path("runtime").isObject(), "native runtime evidence");
  }

  private static void dataset(PromotionFiles files, PromotionProof proof, JsonNode datasetFiles)
      throws IOException {
    require(datasetFiles.isArray() && datasetFiles.size() == 4, "dataset file inventory");
    var names = new HashSet<String>();
    var manifest = files.json(proof.dataset_sha256());
    expect(manifest, "schema", 2);
    expect(manifest, "provenance", "human-control-schema-3");
    expect(manifest, "contract", "rwf-combat-v1");
    require(
        manifest.path("split").isObject() && manifest.path("split").size() >= 10,
        "whole-match human dataset");
    for (var file : datasetFiles) {
      var name = file.path("file").asString();
      var digest = file.path("sha256").asString();
      require(names.add(name), "unique dataset files");
      files.path(digest);
      if (name.equals("manifest.json"))
        require(digest.equals(proof.dataset_sha256()), "dataset fingerprint");
      else expect(manifest.path("files_sha256"), name, digest);
    }
    require(
        names.equals(Set.of("manifest.json", "train.jsonl", "validation.jsonl", "test.jsonl")),
        "dataset split inventory");
  }

  private static void seed(
      PromotionFiles files, PromotionProof proof, PromotionProof.Seed seed, JsonNode source)
      throws IOException {
    var claim = files.json(seed.claim_sha256());
    expect(claim, "seed", seed.seed());
    expect(claim, "startedMs", seed.started_ms());
    expect(claim, "deadlineMs", seed.deadline_ms());
    var result = files.json(seed.result_sha256());
    expect(result, "status", "frozen");
    expect(result, "completedMs", seed.completed_ms());
    expect(result, "manifestSha256", seed.checkpoint_manifest_sha256());
    expect(result, "weightsSha256", seed.weights_sha256());
    var checkpoint = files.json(seed.checkpoint_manifest_sha256());
    expect(checkpoint, "kind", "rwf-trooper-ppo");
    expect(checkpoint, "acceptance", "unaccepted");
    expect(checkpoint, "weights_sha256", seed.weights_sha256());
    var training = checkpoint.path("training");
    expect(training, "provenance", "human-bc-plus-paper-ppo");
    expect(training, "seed", seed.seed());
    expect(training, "dataset_sha256", proof.dataset_sha256());
    expect(training, "test_used_for_selection", false);
    expect(training, "pilot_acceptance_checked", false);
    expect(training.path("curriculum"), "complete", true);
    if (seed.seed() == proof.pilot().seeds().getFirst().seed())
      exportedCheckpoint(checkpoint, source);
  }

  private static void exportedCheckpoint(JsonNode checkpoint, JsonNode source) {
    var original = (ObjectNode) source.deepCopy();
    for (var extra :
        List.of(
            "onnx_sha256", "opset", "inputs", "outputs", "parity", "checkpoint_manifest_sha256"))
      original.remove(extra);
    require(original.equals(checkpoint), "source export differs from checkpoint");
  }

  private static void parity(PromotionFiles files, PromotionProof proof, JsonNode source)
      throws IOException {
    var receipt = files.json(proof.parity().receipt_sha256());
    expect(receipt, "schema", 1);
    expect(receipt, "kind", "rwf-actor-parity");
    expect(receipt, "acceptance", "unaccepted");
    expect(receipt, "backend", "onnxruntime-java-cpu");
    expect(receipt, "parity_contract_sha256", parityContractHash());
    var artifacts = receipt.path("artifacts");
    parityBindings(artifacts, proof, source);
    expect(artifacts, "samples_sha256", proof.parity().samples_sha256());
    expect(receipt, "rtol", proof.parity().rtol());
    expect(receipt, "atol", proof.parity().atol());
    expect(receipt.path("replay"), "batches", proof.parity().batches());
    expect(receipt.path("replay"), "steps", proof.parity().steps());
    var error = receipt.path("replay").path("maximumAbsoluteError");
    require(
        error.isNumber() && Double.isFinite(error.asDouble()) && error.asDouble() >= 0,
        "finite parity error");
    var samples = files.json(proof.parity().samples_sha256());
    expect(samples, "schema", 2);
    parityBindings(samples, proof, source);
    expect(samples, "rtol", proof.parity().rtol());
    expect(samples, "atol", proof.parity().atol());
    var cases = samples.path("cases");
    require(
        cases.isArray() && cases.size() == proof.parity().batches().size(), "parity sample cases");
    for (int index = 0; index < cases.size(); index++) {
      expect(cases.get(index), "rows", proof.parity().batches().get(index));
      require(
          cases.get(index).path("steps").isArray()
              && cases.get(index).path("steps").size() == proof.parity().steps(),
          "parity sample steps");
    }
  }

  private static String parityContractHash() throws IOException {
    var stream = PromotionEvidence.class.getResourceAsStream("/rwf-actor-parity.json");
    if (stream == null) throw new IllegalStateException("missing actor parity contract");
    try (stream) {
      return ActorManifest.sha256(stream.readAllBytes());
    }
  }

  private static void parityBindings(JsonNode artifacts, PromotionProof proof, JsonNode source) {
    expect(artifacts, "onnx_sha256", proof.actor_sha256());
    expect(artifacts, "actor_manifest_sha256", proof.source_manifest_sha256());
    expect(artifacts, "checkpoint_manifest_sha256", proof.checkpoint_manifest_sha256());
    expect(artifacts, "weights_sha256", proof.weights_sha256());
    expect(artifacts, "contract_sha256", source.path("contract_sha256").asString());
  }

  private static void load(PromotionFiles files, PromotionProof proof) throws IOException {
    var load = proof.load();
    var inputs = files.json(load.inputs_sha256());
    expect(inputs, "acceptance", "unaccepted");
    expect(inputs.path("artifacts"), "actor", proof.actor_sha256());
    expect(inputs.path("artifacts"), "manifest", proof.source_manifest_sha256());
    require(nativeHash(inputs.path("native")).equals(proof.native_sha256()), "load native runtime");
    expect(inputs.path("protocol").path("resources"), "cpus", load.cpus());
    expect(inputs.path("protocol").path("resources"), "heap", load.heap());
    expect(inputs.path("protocol").path("resources"), "memoryLimit", "10g");
    var report = files.json(load.result_sha256());
    for (var entry : inputs.properties()) expect(report, entry.getKey(), entry.getValue());
    expect(report.path("baseline"), "ticks", load.baseline_ticks());
    expect(report.path("baseline"), "p95", load.baseline_p95());
    var rows = report.path("rows");
    require(rows.isArray() && rows.size() == load.phases().size(), "load report populations");
    for (int index = 0; index < rows.size(); index++)
      loadRow(rows.get(index), load.phases().get(index));
  }

  private static void loadRow(JsonNode row, PromotionProof.Population phase) {
    expect(row, "bots", phase.bots());
    expect(row, "ticks", phase.ticks());
    expect(row, "liveTicks", phase.live_ticks());
    expect(row, "fullRosterTicks", phase.full_roster_ticks());
    expect(row, "submitted", phase.submitted());
    expect(row, "skipped", phase.skipped());
    expect(row, "rejected", phase.rejected());
    expect(row, "deadlineMet", phase.deadline_met());
    expect(row, "deadlineMissed", phase.deadline_missed());
    expect(row, "p95", phase.p95());
    expect(row, "liveP95", phase.live_p95());
    expect(row, "fullRosterP95", phase.full_roster_p95());
    expect(row, "applied", phase.applied());
    expect(row, "damage", phase.damage());
    expect(row, "damageEvents", phase.damage_events());
  }

  private static void regressions(PromotionFiles files, PromotionProof proof) throws IOException {
    var regression = proof.regressions();
    var evidence = files.json(regression.evidence_sha256());
    expect(evidence, "schema", 1);
    expect(evidence, "kind", "rwf-actor-regressions");
    expect(evidence, "acceptance", "unaccepted");
    expect(evidence, "actor_sha256", proof.actor_sha256());
    expect(evidence, "native_sha256", proof.native_sha256());
    expect(evidence, "cases", regression.cases());
    expect(evidence, "native_floors", regression.native_floors());
    expect(evidence, "simulation_floors", regression.simulation_floors());
  }
}
