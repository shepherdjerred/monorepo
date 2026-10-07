package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorManifest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Synthetic codec evidence only. It is never training, human preference or promotion evidence. */
final class PromotionFixture {
  private final Path directory;
  private final ArrayNode files = PromotionContract.JSON.createArrayNode();
  final ObjectNode proof = PromotionContract.JSON.createObjectNode();
  final ObjectNode source;
  final byte[] actor;
  private final String dataset;
  private final ObjectNode nativeInputs;

  PromotionFixture(Path directory) throws IOException {
    this.directory = directory;
    Files.createDirectory(directory.resolve("evidence"));
    var parity =
        Path.of(
            java.util.Objects.requireNonNull(System.getProperty("thestorm.rwfbots.actorParity")));
    actor = Files.readAllBytes(parity.resolve("onnx/actor.onnx"));
    source =
        (ObjectNode)
            PromotionContract.JSON.readTree(
                Files.readAllBytes(parity.resolve("onnx/manifest.json")));
    var splits =
        object(
            "train.jsonl",
            blob("synthetic training rows"),
            "validation.jsonl",
            blob("synthetic validation rows"),
            "test.jsonl",
            blob("synthetic test rows"));
    var assignments = PromotionContract.JSON.createObjectNode();
    for (int index = 0; index < 10; index++)
      assignments.put(uuid(index), index < 8 ? "train" : index == 8 ? "validation" : "test");
    dataset =
        blob(
            object(
                "schema",
                2,
                "contract",
                "rwf-combat-v1",
                "provenance",
                "human-control-schema-3",
                "split",
                assignments,
                "files_sha256",
                splits));
    var hashes =
        PromotionContract.JSON
            .createArrayNode()
            .add(object("file", "synthetic/native.jar", "sha256", blob("synthetic native bytes")));
    nativeInputs =
        object(
            "hashes",
            hashes,
            "engine",
            "Paper",
            "controllerHz",
            20,
            "timeoutTicks",
            1200,
            "runtime",
            object("fixture", "codec only"));
    var seedFacts = seeds();
    proof
        .put("schema", 1)
        .put("kind", PromotionContract.VALUES.kind())
        .put("promotion_contract_sha256", PromotionContract.SHA256)
        .put("actor_sha256", ActorManifest.sha256(actor))
        .put("dataset_sha256", dataset)
        .put("native_sha256", PromotionEvidence.nativeHash(nativeInputs));
    proof.put(
        "checkpoint_manifest_sha256",
        seedFacts.get(0).path("checkpoint_manifest_sha256").asString());
    proof.put("weights_sha256", seedFacts.get(0).path("weights_sha256").asString());
    var sourceSha = blob(source);
    proof.put("source_manifest_sha256", sourceSha);
    pilot(splits, seedFacts);
    preference();
    parity(parity);
    load();
    regressions();
    proof.set("files", files);
    Files.write(directory.resolve("actor.onnx"), actor);
    Files.writeString(directory.resolve("source-manifest.json"), text(source));
    seal();
  }

  static ObjectNode object(Object... fields) {
    var node = PromotionContract.JSON.createObjectNode();
    for (int index = 0; index < fields.length; index += 2)
      node.set((String) fields[index], PromotionContract.JSON.valueToTree(fields[index + 1]));
    return node;
  }

  private ArrayNode seeds() throws IOException {
    var seeds = PromotionContract.JSON.createArrayNode();
    for (int index = 0; index < 3; index++) {
      var training =
          object(
              "seed",
              17000 + index,
              "dataset_sha256",
              dataset,
              "provenance",
              "human-bc-plus-paper-ppo",
              "test_used_for_selection",
              false,
              "pilot_acceptance_checked",
              false,
              "curriculum",
              object("complete", true));
      var weights = blob("synthetic weights " + index);
      var checkpoint = source.deepCopy();
      for (var extra :
          List.of(
              "onnx_sha256", "opset", "inputs", "outputs", "parity", "checkpoint_manifest_sha256"))
        checkpoint.remove(extra);
      checkpoint.set("training", training);
      checkpoint.put("weights_sha256", weights);
      var checkpointSha = blob(checkpoint);
      if (index == 0) {
        source.set("training", training);
        source.put("weights_sha256", weights).put("checkpoint_manifest_sha256", checkpointSha);
      }
      long start = 1_700_000_000_000L + index * 28_800_000L;
      var claim =
          blob(object("seed", 17000 + index, "startedMs", start, "deadlineMs", start + 28_800_000));
      var result =
          blob(
              object(
                  "status",
                  "frozen",
                  "completedMs",
                  start + 28_800_000,
                  "manifestSha256",
                  checkpointSha,
                  "weightsSha256",
                  weights));
      seeds.add(
          object(
              "seed",
              17000 + index,
              "started_ms",
              start,
              "deadline_ms",
              start + 28_800_000,
              "completed_ms",
              start + 28_800_000,
              "claim_sha256",
              claim,
              "result_sha256",
              result,
              "checkpoint_manifest_sha256",
              checkpointSha,
              "weights_sha256",
              weights,
              "matches_per_opponent",
              200,
              "authored_wins",
              120,
              "basic_wins",
              160,
              "strength_sha256",
              strength(index, weights, checkpointSha)));
    }
    return seeds;
  }

  private String strength(int index, String weights, String checkpoint) throws IOException {
    var games = PromotionContract.JSON.createArrayNode();
    for (int game = 0; game < 400; game++) {
      var won = game < 200 ? game < 120 : game % 200 < 160;
      games.add(
          object(
              "opponent",
              game < 200 ? "authored" : "basic",
              "seed",
              500_000_000 + game % 200 / 2,
              "side",
              game % 2 == 0 ? "red" : "blue",
              "match",
              uuid(1000 + index * 400 + game),
              "result",
              won ? "win" : "loss",
              "frames",
              10,
              "submitted_controls",
              10,
              "confirmed_controls",
              10,
              "applied_controls",
              10,
              "authored_fallbacks",
              0,
              "missed_ticks",
              0,
              "rejected_actions",
              0,
              "memory_resets",
              0,
              "dealt",
              1,
              "received",
              1,
              "seconds",
              1,
              "max_inference_ms",
              1));
    }
    return blob(
        object(
            "version",
            1,
            "engine",
            "Paper",
            "mode",
            "pilot",
            "acceptance",
            "unaccepted",
            "actor_seed",
            17000 + index,
            "weights_sha256",
            weights,
            "manifest_sha256",
            checkpoint,
            "games",
            games,
            "optimized",
            false,
            "retried_duels",
            0,
            "blind_preference_checked",
            false,
            "pilot_acceptance_checked",
            false));
  }

  private void pilot(ObjectNode splits, ArrayNode seeds) throws IOException {
    var datasetFiles =
        PromotionContract.JSON
            .createArrayNode()
            .add(object("file", "manifest.json", "sha256", dataset));
    for (var entry : splits.properties())
      datasetFiles.add(object("file", entry.getKey(), "sha256", entry.getValue()));
    var inputs = blob(object("native", nativeInputs, "dataset", datasetFiles));
    var actors = PromotionContract.JSON.createArrayNode();
    for (var seed : seeds)
      actors.add(
          object(
              "seed",
              seed.path("seed"),
              "weightsSha256",
              seed.path("weights_sha256"),
              "manifestSha256",
              seed.path("checkpoint_manifest_sha256")));
    var plan =
        object(
            "version",
            1,
            "mode",
            "pilot",
            "acceptance",
            "unaccepted",
            "native",
            nativeInputs,
            "actors",
            actors,
            "matchesPerOpponent",
            200,
            "firstSeed",
            500_000_000,
            "retries",
            0,
            "optimized",
            false,
            "pilotAcceptanceChecked",
            false);
    var planSha = blob(plan);
    var claimSha =
        blob(
            object(
                "planSha256",
                ActorManifest.sha256(
                    PromotionContract.JSON
                        .writeValueAsString(plan)
                        .getBytes(StandardCharsets.UTF_8))));
    var ledger =
        blob(
            object(
                "version",
                1,
                "mode",
                "pilot",
                "acceptance",
                "unaccepted",
                "seconds",
                28800,
                "seeds",
                List.of(17000, 17001, 17002),
                "inputSha256",
                inputs));
    proof.set(
        "pilot",
        object(
            "ledger_sha256",
            ledger,
            "inputs_sha256",
            inputs,
            "strength_claim_sha256",
            claimSha,
            "strength_plan_sha256",
            planSha,
            "seeds",
            seeds));
  }

  private void preference() throws IOException {
    var pairs = PromotionContract.JSON.createArrayNode();
    var keyPairs = PromotionContract.JSON.createArrayNode();
    var answers = PromotionContract.JSON.createArrayNode();
    var rows = PromotionContract.JSON.createArrayNode();
    for (int pair = 1; pair <= 20; pair++) {
      var left =
          object(
              "file",
              "pair-" + String.format(java.util.Locale.ROOT, "%02d", pair) + "-A.mp4",
              "sha256",
              blob("synthetic clip A " + pair));
      var right =
          object(
              "file",
              "pair-" + String.format(java.util.Locale.ROOT, "%02d", pair) + "-B.mp4",
              "sha256",
              blob("synthetic clip B " + pair));
      pairs.add(
          object(
              "pair",
              pair,
              "subject",
              pair % 2 == 1 ? "red fighter" : "blue fighter",
              "A",
              left,
              "B",
              right));
      keyPairs.add(object("pair", pair, "learned", "A"));
      answers.add(
          object(
              "pair", pair, "choice", pair <= 15 ? "A" : "tie", "reason", "synthetic codec vote"));
      rows.add(
          object(
              "pair",
              pair,
              "preferred",
              pair <= 15 ? "learned" : "tie",
              "reason",
              "synthetic codec vote"));
    }
    var review = blob(object("version", 1, "pairs", pairs));
    var key =
        blob(
            object(
                "version",
                1,
                "actor_sha256",
                proof.path("actor_sha256"),
                "review_sha256",
                review,
                "pairs",
                keyPairs));
    var ballot =
        blob(
            object(
                "version",
                1,
                "review_sha256",
                review,
                "source",
                "manual-human-review",
                "answers",
                answers));
    var plan =
        blob(
            object(
                "version",
                1,
                "actor_sha256",
                proof.path("actor_sha256"),
                "files",
                List.of(object("sha256", dataset))));
    var claim = blob(object("plan_sha256", plan));
    var result =
        blob(
            object(
                "version",
                1,
                "actor_sha256",
                proof.path("actor_sha256"),
                "review_sha256",
                review,
                "key_sha256",
                key,
                "ballot_sha256",
                ballot,
                "plan_sha256",
                plan,
                "pairs",
                20,
                "learnedVotes",
                15,
                "authoredVotes",
                0,
                "ties",
                5,
                "rows",
                rows));
    proof.set(
        "preference",
        object(
            "candidate_seed",
            17000,
            "pairs",
            20,
            "learned_votes",
            15,
            "authored_votes",
            0,
            "ties",
            5,
            "source",
            "manual-human-review",
            "claim_sha256",
            claim,
            "plan_sha256",
            plan,
            "review_sha256",
            review,
            "key_sha256",
            key,
            "ballot_sha256",
            ballot,
            "result_sha256",
            result));
  }

  private void parity(Path parity) throws IOException {
    String parityContract;
    try (var stream =
        java.util.Objects.requireNonNull(
            getClass().getResourceAsStream("/rwf-actor-parity.json"))) {
      parityContract = ActorManifest.sha256(stream.readAllBytes());
    }
    var samples =
        (ObjectNode)
            PromotionContract.JSON.readTree(Files.readAllBytes(parity.resolve("samples.json")));
    var bindings =
        object(
            "onnx_sha256",
            proof.path("actor_sha256"),
            "actor_manifest_sha256",
            proof.path("source_manifest_sha256"),
            "checkpoint_manifest_sha256",
            proof.path("checkpoint_manifest_sha256"),
            "weights_sha256",
            proof.path("weights_sha256"),
            "contract_sha256",
            source.path("contract_sha256"));
    for (var entry : bindings.properties()) samples.set(entry.getKey(), entry.getValue());
    var samplesSha = blob(samples);
    bindings.put("samples_sha256", samplesSha);
    var receipt =
        blob(
            object(
                "schema",
                1,
                "kind",
                "rwf-actor-parity",
                "acceptance",
                "unaccepted",
                "backend",
                "onnxruntime-java-cpu",
                "parity_contract_sha256",
                parityContract,
                "artifacts",
                bindings,
                "rtol",
                1e-4,
                "atol",
                1e-5,
                "replay",
                object("batches", List.of(1, 3, 20, 100), "steps", 16, "maximumAbsoluteError", 0)));
    proof.set(
        "parity",
        object(
            "receipt_sha256",
            receipt,
            "samples_sha256",
            samplesSha,
            "batches",
            List.of(1, 3, 20, 100),
            "steps",
            16,
            "rtol",
            1e-4,
            "atol",
            1e-5));
  }

  private void load() throws IOException {
    var raw = new PromotionLoadFixture();
    var phases = PromotionContract.JSON.createArrayNode();
    var rows = PromotionContract.JSON.createArrayNode();
    for (var bots : List.of(20, 50, 100)) {
      long count = bots * 3000L;
      phases.add(
          object(
              "bots",
              bots,
              "ticks",
              3000,
              "live_ticks",
              3000,
              "full_roster_ticks",
              3000,
              "submitted",
              count,
              "skipped",
              0,
              "rejected",
              0,
              "deadline_met",
              count,
              "deadline_missed",
              0,
              "maximum_batch",
              bots,
              "p95",
              20,
              "live_p95",
              20,
              "full_roster_p95",
              20,
              "applied",
              count,
              "damage",
              count / 100.0,
              "damage_events",
              count / 100));
      rows.add(
          object(
              "bots",
              bots,
              "ticks",
              3000,
              "liveTicks",
              3000,
              "fullRosterTicks",
              3000,
              "submitted",
              count,
              "skipped",
              0,
              "rejected",
              0,
              "deadlineMet",
              count,
              "deadlineMissed",
              0,
              "p95",
              20,
              "liveP95",
              20,
              "fullRosterP95",
              20,
              "applied",
              count,
              "damage",
              count / 100.0,
              "damageEvents",
              count / 100));
    }
    var inputs =
        object(
            "acceptance",
            "unaccepted",
            "native",
            nativeInputs,
            "artifacts",
            object(
                "actor",
                proof.path("actor_sha256"),
                "manifest",
                proof.path("source_manifest_sha256")),
            "protocol",
            object("resources", object("cpus", 4, "heap", "8G", "memoryLimit", "10g")));
    var report = inputs.deepCopy();
    report.set("baseline", object("ticks", 1800, "p95", 20));
    report.set("rows", rows);
    proof.set(
        "load",
        object(
            "inputs_sha256",
            blob(inputs),
            "phases_sha256",
            blob(raw.measurements),
            "log_sha256",
            blob(raw.log()),
            "result_sha256",
            blob(report),
            "cpus",
            4,
            "heap",
            "8G",
            "memory_limit_bytes",
            10737418240L,
            "baseline_ticks",
            1800,
            "baseline_p95",
            20,
            "phases",
            phases));
  }

  private void regressions() throws IOException {
    var cases =
        PromotionContract.VALUES.regressionCases().stream()
            .map(name -> object("name", name, "checks", 1, "failures", 0, "skipped", 0))
            .toList();
    var nativeFloors =
        object(
            "bots",
            16,
            "minimum_spacing",
            2.5,
            "minimum_width_at_8",
            16,
            "minimum_width_at_contact",
            16,
            "minimum_forward",
            0.25,
            "maximum_winding",
            2.5);
    var simulationFloors =
        object(
            "strategy_pairs",
            16,
            "contacts",
            16,
            "minimum_width",
            15,
            "median_width",
            24,
            "mean_forward",
            0.45,
            "maximum_winding",
            2.5);
    var evidence =
        object(
            "schema",
            1,
            "kind",
            "rwf-actor-regressions",
            "acceptance",
            "unaccepted",
            "actor_sha256",
            proof.path("actor_sha256"),
            "native_sha256",
            proof.path("native_sha256"),
            "cases",
            cases,
            "native_floors",
            nativeFloors,
            "simulation_floors",
            simulationFloors);
    evidence.remove("schema");
    evidence.remove("kind");
    evidence.remove("acceptance");
    var report = evidence.deepCopy();
    report.put("schema", 1).put("kind", "rwf-actor-regressions").put("acceptance", "unaccepted");
    evidence.put("evidence_sha256", blob(report));
    proof.set("regressions", evidence);
  }

  void seal() throws IOException {
    var bytes = text(proof);
    Files.writeString(directory.resolve("promotion.json"), bytes);
    var accepted = source.deepCopy();
    accepted
        .put("acceptance", "accepted")
        .put("promotion_sha256", ActorManifest.sha256(bytes.getBytes(StandardCharsets.UTF_8)));
    Files.writeString(directory.resolve("manifest.json"), text(accepted));
  }

  String blob(Object value) throws IOException {
    var bytes =
        value instanceof String string
            ? string.getBytes(StandardCharsets.UTF_8)
            : text(value).getBytes(StandardCharsets.UTF_8);
    var digest = ActorManifest.sha256(bytes);
    var file = directory.resolve("evidence/" + digest + ".blob");
    if (!Files.exists(file)) {
      Files.write(file, bytes);
      files.add(object("file", "evidence/" + digest + ".blob", "sha256", digest));
    }
    return digest;
  }

  private static String text(Object value) {
    return PromotionContract.JSON.writeValueAsString(value) + "\n";
  }

  private static String uuid(int value) {
    return new UUID(0, value + 1L).toString();
  }
}
