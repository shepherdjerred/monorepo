package com.shepherdjerred.thestorm.agent.adapter.http;

import com.shepherdjerred.thestorm.agent.app.BrainClient;
import com.shepherdjerred.thestorm.agent.app.BrainDisabledException;
import com.shepherdjerred.thestorm.agent.app.BrainException;
import com.shepherdjerred.thestorm.agent.app.ClassifyCase;
import com.shepherdjerred.thestorm.agent.app.ClassifyVerdict;
import com.shepherdjerred.thestorm.agent.app.Notes;
import com.shepherdjerred.thestorm.agent.app.TriageCase;
import com.shepherdjerred.thestorm.agent.app.TriageProposal;
import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import com.shepherdjerred.thestorm.essentials.app.ModLogRecord;
import com.shepherdjerred.thestorm.tickets.app.CommentSnapshot;
import com.shepherdjerred.thestorm.tickets.app.LocationSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TriageSnapshot;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * The storm-brain service over HTTPS. Requests are strict both ways: cases are clipped to the wire
 * limits before they leave, and answers with unknown or missing keys fail the call. The limits
 * below mirror {@code storm-brain/src/schemas.ts}; when they drift, the service's 400 names the
 * skew instead of misreading the case.
 *
 * <p>Calls never touch the caller thread: {@link HttpClient#sendAsync} runs them on a
 * virtual-thread executor this client owns. {@link #close} releases it; the module calls it on
 * disable.
 */
public final class HttpBrainClient implements BrainClient, AutoCloseable {

  /** The suspicious line and its context, newest first. */
  private static final int MAX_CLASSIFY_LINES = 8;

  private static final int MAX_COMMENTS = 50;
  private static final int MAX_HISTORY = 20;
  private static final int MAX_TRIAGE_CHAT = 20;

  /** Chat text, summaries, bodies, evidence, replies, labels, reasoning. */
  private static final int MAX_TEXT = 2000;

  /** Category, status, priority, action, and actor ids. */
  private static final int MAX_ID = 32;

  private static final int MAX_REASON = 500;
  private static final int MAX_WORLD = 64;

  /** How much of a failure body lands in the exception, for operability without log spam. */
  private static final int MAX_ERROR_BODY = 500;

  private static final String DISABLED_BODY = "flow disabled";

  private final JsonMapper json = JsonMapper.builder().build();

  private final JsonMapper answers =
      JsonMapper.builder()
          .enable(
              DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
              DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES,
              DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
          .build();

  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
  private final HttpClient http;
  private final URI classifyUri;
  private final URI triageUri;
  private final String bearerToken;
  private final Duration timeout;

  /**
   * Calls the service at {@code baseUrl}.
   *
   * @param baseUrl the service origin, as validated by the config
   * @param bearerToken the service bearer token, never logged
   * @param timeout how long a call may take
   */
  public HttpBrainClient(URI baseUrl, String bearerToken, Duration timeout) {
    this.http = HttpClient.newBuilder().executor(executor).build();
    var base = baseUrl.toString().replaceAll("/+$", "");
    this.classifyUri = URI.create(base + "/v1/classify");
    this.triageUri = URI.create(base + "/v1/triage");
    this.bearerToken = bearerToken;
    this.timeout = timeout;
  }

  @Override
  public CompletableFuture<ClassifyVerdict> classify(ClassifyCase kase) {
    var lines = kase.lines().stream().filter(line -> !line.text().isBlank()).toList();
    if (lines.isEmpty()) {
      throw new IllegalArgumentException("classify needs at least one non-blank line");
    }
    var request =
        new ClassifyRequest(
            new Player(kase.player(), kase.playerName()),
            lines.stream().limit(MAX_CLASSIFY_LINES).map(HttpBrainClient::line).toList());
    return post(classifyUri, "classify", request, ClassifyAnswer.class)
        .thenApply(HttpBrainClient::verdict);
  }

  @Override
  public CompletableFuture<TriageProposal> triage(TriageCase kase) {
    var request =
        new TriageRequest(
            ticket(kase.ticket()),
            newest(kase.comments(), MAX_COMMENTS).stream().map(HttpBrainClient::comment).toList(),
            kase.reporterHistory().stream()
                .limit(MAX_HISTORY)
                .map(HttpBrainClient::history)
                .toList(),
            kase.reporterBanned(),
            kase.reporterRecentChat().stream()
                .limit(MAX_TRIAGE_CHAT)
                .map(HttpBrainClient::line)
                .toList());
    return post(triageUri, "triage", request, TriageAnswer.class)
        .thenApply(HttpBrainClient::proposal);
  }

  @Override
  public void close() {
    executor.shutdownNow();
  }

  private <Answer> CompletableFuture<Answer> post(
      URI uri, String flow, Object request, Class<Answer> answer) {
    final String body;
    try {
      body = json.writeValueAsString(request);
    } catch (RuntimeException bad) {
      return CompletableFuture.failedFuture(
          new BrainException("storm-brain " + flow + " request is unserializable", bad));
    }
    var call =
        HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Authorization", "Bearer " + bearerToken)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
    return http.sendAsync(call, HttpResponse.BodyHandlers.ofString())
        .handle(
            (response, failure) -> {
              if (failure != null) {
                throw new BrainException("storm-brain " + flow + " call failed", failure);
              }
              return answer(flow, response, answer);
            });
  }

  private <Answer> Answer answer(String flow, HttpResponse<String> response, Class<Answer> answer) {
    var body = response.body() == null ? "" : response.body();
    if (response.statusCode() == 503 && body.contains(DISABLED_BODY)) {
      throw new BrainDisabledException(flow);
    }
    if (response.statusCode() != 200) {
      throw new BrainException(
          "storm-brain "
              + flow
              + " answered "
              + response.statusCode()
              + ": "
              + Notes.clip(body.strip(), MAX_ERROR_BODY));
    }
    try {
      return answers.readValue(body, answer);
    } catch (RuntimeException bad) {
      throw new BrainException(
          "storm-brain "
              + flow
              + " answered outside the contract: "
              + Notes.clip(body.strip(), MAX_ERROR_BODY),
          bad);
    }
  }

  private static ClassifyVerdict verdict(ClassifyAnswer answer) {
    try {
      return new ClassifyVerdict(
          Optional.ofNullable(answer.offense()),
          answer.confidence(),
          answer.label(),
          answer.reasoning(),
          answer.model(),
          answer.costMicros());
    } catch (RuntimeException bad) {
      throw new BrainException("storm-brain classify verdict is outside the contract", bad);
    }
  }

  private static TriageProposal proposal(TriageAnswer answer) {
    try {
      return new TriageProposal(
          answer.priorityId(),
          answer.confidence(),
          answer.duplicates(),
          answer.evidence(),
          answer.draftReply(),
          answer.resolve(),
          answer.resolutionNote(),
          answer.model(),
          answer.costMicros());
    } catch (RuntimeException bad) {
      throw new BrainException("storm-brain triage proposal is outside the contract", bad);
    }
  }

  /** The newest {@code max} of an oldest-first list, still oldest-first. */
  private static <T> List<T> newest(List<T> oldestFirst, int max) {
    return oldestFirst.subList(Math.max(0, oldestFirst.size() - max), oldestFirst.size());
  }

  private static ChatLine line(ChatSample sample) {
    return new ChatLine(Notes.clip(sample.text(), MAX_TEXT), sample.at().toString());
  }

  private static Ticket ticket(TicketSnapshot snapshot) {
    return new Ticket(
        snapshot.id(),
        snapshot.reporter(),
        Notes.clip(snapshot.categoryId(), MAX_ID),
        Notes.clip(snapshot.statusId(), MAX_ID),
        Notes.clip(snapshot.priorityId(), MAX_ID),
        Notes.clip(snapshot.summary(), MAX_TEXT),
        snapshot.location().map(HttpBrainClient::location).orElse(null),
        snapshot.createdAt().toString(),
        snapshot.updatedAt().toString(),
        snapshot.claimer().orElse(null),
        snapshot.triage().map(HttpBrainClient::triage).orElse(null));
  }

  private static Location location(LocationSnapshot snapshot) {
    return new Location(
        Notes.clip(snapshot.world(), MAX_WORLD), snapshot.x(), snapshot.y(), snapshot.z());
  }

  private static Triage triage(TriageSnapshot snapshot) {
    return new Triage(
        Notes.clip(snapshot.priorityId(), MAX_ID),
        snapshot.duplicateIds(),
        Notes.clip(snapshot.evidence(), MAX_TEXT),
        Notes.clip(snapshot.draftReply(), MAX_TEXT),
        snapshot.at().toString());
  }

  private static Comment comment(CommentSnapshot snapshot) {
    return new Comment(
        snapshot.id(),
        snapshot.author(),
        snapshot.staffOnly(),
        Notes.clip(snapshot.body(), MAX_TEXT),
        snapshot.at().toString());
  }

  private static History history(ModLogRecord record) {
    return new History(
        Notes.clip(record.actionId(), MAX_ID),
        Notes.clip(record.actorName(), MAX_ID),
        record.reason().isBlank() ? "(no reason given)" : Notes.clip(record.reason(), MAX_REASON),
        record.at().toString(),
        record.expiresAt().map(Instant::toString).orElse(null));
  }

  private record Player(UUID id, String name) {}

  private record ChatLine(String text, String at) {}

  private record ClassifyRequest(Player player, List<ChatLine> lines) {}

  private record ClassifyAnswer(
      @Nullable String offense,
      double confidence,
      String label,
      String reasoning,
      String model,
      long costMicros) {}

  private record Ticket(
      long id,
      UUID reporter,
      String categoryId,
      String statusId,
      String priorityId,
      String summary,
      @Nullable Location location,
      String createdAt,
      String updatedAt,
      @Nullable UUID claimer,
      @Nullable Triage triage) {}

  private record Location(String world, int x, int y, int z) {}

  private record Triage(
      String priorityId, List<Long> duplicateIds, String evidence, String draftReply, String at) {}

  private record Comment(long id, UUID author, boolean staffOnly, String body, String at) {}

  private record History(
      String actionId, String actorName, String reason, String at, @Nullable String expiresAt) {}

  private record TriageRequest(
      Ticket ticket,
      List<Comment> comments,
      List<History> reporterHistory,
      boolean reporterBanned,
      List<ChatLine> reporterRecentChat) {}

  private record TriageAnswer(
      String priorityId,
      double confidence,
      List<Long> duplicates,
      String evidence,
      String draftReply,
      boolean resolve,
      String resolutionNote,
      String model,
      long costMicros) {}
}
