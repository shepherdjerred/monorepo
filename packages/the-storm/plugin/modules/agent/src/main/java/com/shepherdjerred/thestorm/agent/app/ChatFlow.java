package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.ChatSample;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.JudgeInput;
import com.shepherdjerred.thestorm.agent.domain.JudgeOutcome;
import com.shepherdjerred.thestorm.agent.domain.Ladder;
import com.shepherdjerred.thestorm.agent.domain.LadderJudge;
import com.shepherdjerred.thestorm.agent.domain.LadderStep;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.agent.domain.PrefilterVerdict;
import com.shepherdjerred.thestorm.agent.domain.Prefilters;
import com.shepherdjerred.thestorm.agent.domain.Sampler;
import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Watches Global chat and enforces the ladders. Every line joins the recent-chat ring; players'
 * lines run the deterministic pre-filters first. Obvious offenses enforce without a brain call,
 * ambiguous ones ask the brain, and clean lines pass untouched and unrecorded.
 *
 * <p>Decisions are recorded before they act, so a crash never leaves an unaudited mute. Temporary
 * bans never execute: the ladder prescribes them, the agent files a review ticket, and a human
 * swings.
 */
public final class ChatFlow {

  private static final String MODEL_PREFILTER = "prefilter";
  private static final String ISSUER = "StormAgent";
  private static final int CONTEXT_LINES = 5;
  private static final int REASON_LENGTH = 140;

  private final RecentChat recents;
  private final ChatService chat;
  private final PlayerContact contact;
  private final AgentServices services;

  public ChatFlow(
      RecentChat recents, ChatService chat, PlayerContact contact, AgentServices services) {
    this.recents = recents;
    this.chat = chat;
    this.contact = contact;
    this.services = services;
  }

  /** Handles one Global line. Completes when the decision is recorded and acted on. */
  public CompletableFuture<Void> onChatLine(ChatLine line) {
    if (!(line.author() instanceof ChatAuthor.InGame(var id, var name))) {
      recents.record(line);
      return CompletableFuture.completedFuture(null);
    }
    var current = new ChatSample(id, name, line.text(), line.at());
    var recent =
        recents.lastBy(id, CONTEXT_LINES).stream()
            .map(before -> new ChatSample(id, name, before.text(), before.at()))
            .toList();
    recents.record(line);
    return switch (Prefilters.check(current, recent, services.config().limits())) {
      case PrefilterVerdict.Allow _ -> CompletableFuture.completedFuture(null);
      case PrefilterVerdict.Act(var offense, var signal) ->
          decide(
              current,
              new Verdict(
                  Optional.of(offense), 1.0, "prefilter/" + signal, signal, MODEL_PREFILTER, 0));
      case PrefilterVerdict.Check(var signal) -> checkWithBrain(current, recent, signal);
    };
  }

  private CompletableFuture<Void> checkWithBrain(
      ChatSample current, List<ChatSample> recent, String signal) {
    var lines = new ArrayList<ChatSample>();
    lines.add(current);
    lines.addAll(recent);
    return services
        .brain()
        .classify(new ClassifyCase(current.player(), current.playerName(), List.copyOf(lines)))
        .thenCompose(
            verdict ->
                decide(
                    current,
                    new Verdict(
                        offenseOf(verdict),
                        verdict.confidence(),
                        verdict.label(),
                        signal + ": " + verdict.reasoning(),
                        verdict.model(),
                        verdict.costMicros())))
        // A switched-off flow is steady state: the line passes unjudged and unrecorded.
        .exceptionallyCompose(
            failure ->
                BrainDisabledException.isCauseOf(failure)
                    ? CompletableFuture.completedFuture(null)
                    : CompletableFuture.failedFuture(failure));
  }

  private CompletableFuture<Void> decide(ChatSample current, Verdict verdict) {
    var table = services.config().table();
    var window = verdict.offense().flatMap(table::ladder).map(Ladder::window).orElse(Duration.ZERO);
    var since = services.time().instant().minus(window);
    return services
        .log()
        .strikes(current.player(), verdict.offense().orElse(Offense.OTHER), since)
        .thenCompose(
            strikes ->
                settle(
                    current,
                    new JudgeInput(
                        verdict.offense(),
                        verdict.confidence(),
                        services.config().classifyThreshold(),
                        strikes),
                    verdict));
  }

  private CompletableFuture<Void> settle(ChatSample current, JudgeInput input, Verdict verdict) {
    return switch (LadderJudge.judge(input, services.config().table())) {
      case JudgeOutcome.Allow(var detail) ->
          record(new Attempt(current, verdict, DecisionAction.ALLOW, Optional.empty(), detail))
              .thenApply(done -> null);
      case JudgeOutcome.Escalate(var detail) ->
          escalate(current, verdict, Optional.empty(), detail);
      case JudgeOutcome.Act(var step, _, var rung) ->
          switch (step.action()) {
            case WARN, MUTE, KICK -> perform(current, verdict, step, rung);
            case TEMPBAN, ESCALATE ->
                escalate(current, verdict, Optional.of(rung), "ladder-" + step.action().id());
          };
    };
  }

  private CompletableFuture<Void> perform(
      ChatSample current, Verdict verdict, LadderStep step, int rung) {
    var action =
        switch (step.action()) {
          case WARN -> DecisionAction.WARN;
          case MUTE -> DecisionAction.MUTE;
          case KICK -> DecisionAction.KICK;
          case TEMPBAN, ESCALATE ->
              throw new IllegalStateException(
                  "unexecutable rung reached perform: " + step.action());
        };
    return record(new Attempt(current, verdict, action, Optional.of(rung), "rung " + rung))
        .thenCompose(
            done -> {
              if (services.config().shadow()) {
                return CompletableFuture.completedFuture(null);
              }
              return switch (step.action()) {
                case WARN ->
                    contact.tell(current.player(), warningFor(verdict)).thenApply(sent -> null);
                case MUTE -> {
                  chat.mute(
                      current.player(),
                      step.length().orElseThrow(),
                      Notes.clip(verdict.label(), REASON_LENGTH),
                      ISSUER);
                  yield CompletableFuture.completedFuture(null);
                }
                case KICK ->
                    contact
                        .kick(current.player(), Notes.clip(verdict.label(), REASON_LENGTH))
                        .thenApply(sent -> null);
                case TEMPBAN, ESCALATE ->
                    throw new IllegalStateException(
                        "unexecutable rung reached perform: " + step.action());
              };
            });
  }

  private CompletableFuture<Void> escalate(
      ChatSample current, Verdict verdict, Optional<Integer> rung, String detail) {
    return record(new Attempt(current, verdict, DecisionAction.ESCALATE, rung, detail))
        .thenCompose(
            decision -> {
              if (services.config().shadow()) {
                return CompletableFuture.completedFuture(null);
              }
              var offense = verdict.offense().map(Offense::id).orElse("review");
              return services
                  .tickets()
                  .openAgentReport(
                      categoryFor(verdict.offense()),
                      "Agent escalation: " + offense + " by " + current.playerName())
                  .thenCompose(
                      opened ->
                          switch (opened) {
                            case Result.Ok<TicketSnapshot, TicketFailure>(var ticket) ->
                                services
                                    .tickets()
                                    .addAgentComment(
                                        ticket.id(),
                                        evidence(decision.id(), current, verdict),
                                        true)
                                    .thenApply(noted -> null);
                            case Result.Err<TicketSnapshot, TicketFailure> _ ->
                                CompletableFuture.completedFuture(null);
                          });
            });
  }

  private CompletableFuture<AgentDecision> record(Attempt attempt) {
    return services
        .log()
        .record(
            new DecisionDraft(
                attempt.current().player(),
                attempt.verdict().offense().orElse(Offense.OTHER),
                Optional.empty(),
                Notes.clip(attempt.verdict().label(), AgentDecision.MAX_LABEL_LENGTH),
                attempt.verdict().confidence(),
                Notes.clip(attempt.verdict().model(), AgentDecision.MAX_LABEL_LENGTH),
                attempt.action(),
                services.config().shadow(),
                Sampler.shouldSample(services.random(), services.config().reviewSamplePercent()),
                attempt.rung(),
                attempt.verdict().costMicros(),
                Notes.clip(
                    attempt.detail() + ": " + attempt.verdict().reasoning(),
                    AgentDecision.MAX_NOTE_LENGTH)),
            services.time().instant());
  }

  private static Optional<Offense> offenseOf(ClassifyVerdict verdict) {
    return verdict.offenseId().map(ChatFlow::offenseById);
  }

  private static Offense offenseById(String id) {
    try {
      return Offense.fromId(id);
    } catch (IllegalArgumentException unknown) {
      // Fail loudly: the brain named something outside the offense list, and
      // recording it as clean would invent a verdict for a broken contract.
      throw new BrainException("unknown offense id: " + id, unknown);
    }
  }

  private static String categoryFor(Optional<Offense> offense) {
    return switch (offense.orElse(Offense.OTHER)) {
      case GRIEF -> "grief";
      case THEFT -> "theft";
      case CHEAT -> "cheat";
      case SPAM, ADVERTISING, SLUR, TOXICITY, HARASSMENT -> "chat";
      case OTHER -> "other";
    };
  }

  private static String warningFor(Verdict verdict) {
    var gerund =
        switch (verdict.offense().orElse(Offense.OTHER)) {
          case SPAM -> "spamming chat";
          case ADVERTISING -> "advertising";
          case SLUR -> "using slurs";
          case TOXICITY -> "that language";
          case GRIEF -> "griefing";
          case THEFT -> "stealing";
          case CHEAT -> "cheating";
          case HARASSMENT -> "harassing other players";
          case OTHER -> "that behavior";
        };
    return "A Storm staff member warns you: please stop " + gerund + ".";
  }

  private static String evidence(long decisionId, ChatSample current, Verdict verdict) {
    return Notes.clip(
        "Decision #"
            + decisionId
            + ": "
            + verdict.label()
            + " (confidence "
            + verdict.confidence()
            + "). "
            + verdict.reasoning()
            + " Said: \""
            + current.text()
            + "\".",
        TicketService.MAX_AGENT_COMMENT);
  }

  private record Verdict(
      Optional<Offense> offense,
      double confidence,
      String label,
      String reasoning,
      String model,
      long costMicros) {}

  private record Attempt(
      ChatSample current,
      Verdict verdict,
      DecisionAction action,
      Optional<Integer> rung,
      String detail) {}
}
