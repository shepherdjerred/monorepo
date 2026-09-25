package com.shepherdjerred.thestorm.npcs.app;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.choices;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.close;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.goTo;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.option;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.then;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.Fixtures;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.tracks.app.Purchase;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Conversations end to end, with a fake dialog renderer and fake tracks. */
final class NpcTalkTest {

  private static final DialogueGraph STAN_TALK =
      new DialogueGraph(
          "stan",
          "Stan",
          "greet",
          Map.of(
              "greet",
              choices(
                  "Buy low, sell high.",
                  option("Train", new OptionEffect.OpenTrainer()),
                  goTo("about"),
                  option("Quest", new OptionEffect.RunAction("quests.accept")),
                  option("Shop", new OptionEffect.RunAction("shops.open")),
                  close()),
              "about",
              then("I run the shop.", "greet")));

  private static final NpcDefinition STAN =
      define("stan", Optional.of("stan"), Optional.of("shopkeeper"));
  private static final NpcDefinition DARREN =
      define("darren", Optional.empty(), Optional.of("mechanic"));
  private static final NpcDefinition BRAXTON =
      define("braxton", Optional.empty(), Optional.empty());

  private static NpcDefinition define(
      String id, Optional<String> dialogue, Optional<String> trainer) {
    var base = Fixtures.npc(id);
    return new NpcDefinition(
        id,
        base.name(),
        base.description(),
        base.skin(),
        base.home(),
        base.pose(),
        base.roles(),
        base.schedule(),
        dialogue,
        trainer);
  }

  private ServerMock server;
  private PlayerMock player;
  private NpcCatalog catalog;
  private DialogueRegistry dialogues;
  private ActionRegistry actions;
  private Fakes.Presenter presenter;
  private Fakes.Purchases purchases;
  private Fakes.Levels levels;
  private NpcTalk talk;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    player = server.addPlayer("Alice");
    catalog =
        new NpcCatalog(
            new Content(
                Map.of("stan", STAN, "darren", DARREN, "braxton", BRAXTON),
                Map.of("stan", STAN_TALK),
                Map.of(),
                Map.of()));
    dialogues = new DialogueRegistry();
    actions = new ActionRegistry();
    presenter = new Fakes.Presenter();
    purchases = new Fakes.Purchases();
    levels = new Fakes.Levels();
    var wording =
        new TrainerWording(
            amount -> amount + " crystals",
            InstantSource.fixed(Instant.parse("2026-09-25T12:00:00Z")));
    talk =
        new NpcTalk(
            new NpcTalk.Wiring(
                catalog, dialogues, actions, presenter, "Continue", ComponentLogger.logger("test")),
            new Trainer(purchases, levels, wording, Runnable::run));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private List<String> messages() {
    var seen = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      seen.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return seen;
  }

  @Test
  void talkingShowsTheNpcsDialogue() {
    talk.talk(player, STAN);
    var shown = presenter.last();
    assertThat(shown.player()).isSameAs(player);
    assertThat(shown.screen().title()).isEqualTo("Stan");
    assertThat(shown.screen().body()).isEqualTo("Buy low, sell high.");
  }

  @Test
  void buttonsNavigateAndCountOnce() {
    talk.talk(player, STAN);
    var greet = presenter.last();
    greet.press("To about");
    assertThat(presenter.last().screen().body()).isEqualTo("I run the shop.");
    // The same click delivered again does nothing.
    greet.press("To about");
    greet.press("Bye");
    assertThat(presenter.shown).hasSize(2);
    assertThat(presenter.closed).isEmpty();
    presenter.last().press("Continue");
    assertThat(presenter.last().screen().body()).isEqualTo("Buy low, sell high.");
    presenter.last().press("Bye");
    assertThat(presenter.closed).containsExactly(player);
  }

  @Test
  void aProviderSpeaksBeforeTheNpcsOwnDialogue() {
    var quest =
        new DialogueGraph(
            "q", "Stan", "offer", Map.of("offer", choices("Got a job for you.", close())));
    dialogues.register(
        (who, npc) -> npc.id().equals("stan") ? Optional.of(quest) : Optional.empty());
    talk.talk(player, STAN);
    assertThat(presenter.last().screen().body()).isEqualTo("Got a job for you.");
  }

  @Test
  void anInvalidProvidedDialogueFailsLoudly() {
    var broken = new DialogueGraph("q", "Stan", "missing", Map.of("offer", choices("x", close())));
    dialogues.register((who, npc) -> Optional.of(broken));
    assertThatThrownBy(() -> talk.talk(player, STAN)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void actionsRunAfterTheDialogCloses() {
    var ran = new ArrayList<NpcRef>();
    actions.register("quests.accept", (who, npc) -> ran.add(npc));
    talk.talk(player, STAN);
    presenter.last().press("Quest");
    assertThat(presenter.closed).containsExactly(player);
    assertThat(ran).containsExactly(NpcRef.of(STAN));
  }

  @Test
  void anUnregisteredActionTellsThePlayer() {
    talk.talk(player, STAN);
    presenter.last().press("Shop");
    assertThat(messages()).containsExactly("[NPCs]: That isn't available right now.");
  }

  @Test
  void anNpcWithNothingToSayStaysQuiet() {
    talk.talk(player, BRAXTON);
    assertThat(presenter.shown).isEmpty();
  }

  @Test
  void aTrainerQuotesConfirmsAndBuys() {
    purchases.nextQuote =
        CompletableFuture.completedFuture(Result.ok(new Quote(Track.MECHANIC, 1, 1000)));
    // Darren has no dialogue, so the trainer opens directly.
    talk.talk(player, DARREN);
    assertThat(purchases.quoted).containsExactly(Track.MECHANIC);
    assertThat(presenter.last().screen().body())
        .isEqualTo("Mechanic: level 0 of 5.\nLevel 1 costs 1000 crystals.");
    presenter.last().press("Buy level 1");
    assertThat(presenter.last().screen().body())
        .isEqualTo("Buy Mechanic level 1 for 1000 crystals?");
    purchases.nextBuy = Result.ok(new Purchase(new Quote(Track.MECHANIC, 1, 1000), true, 42));
    levels.levels.put(Track.MECHANIC, 1);
    purchases.nextQuote =
        CompletableFuture.completedFuture(Result.ok(new Quote(Track.MECHANIC, 2, 2500)));
    presenter.last().press("Confirm");
    assertThat(purchases.bought).containsExactly(new Quote(Track.MECHANIC, 1, 1000));
    assertThat(presenter.last().screen().body())
        .isEqualTo(
            """
                You are now level 1 in Mechanic. Mechanic is your primary track.
                Mechanic: level 1 of 5.
                Level 2 costs 2500 crystals.\
                """);
  }

  @Test
  void confirmingCanGoBack() {
    talk.talk(player, DARREN);
    presenter.last().press("Buy level 1");
    presenter.last().press("Back");
    assertThat(presenter.last().screen().body()).contains("Level 1 costs");
    assertThat(purchases.bought).isEmpty();
  }

  @Test
  void aRefusedQuoteExplainsWhy() {
    purchases.nextQuote =
        CompletableFuture.completedFuture(
            Result.err(
                List.of(
                    new PurchaseProblem.CannotAfford(1000, 250),
                    new PurchaseProblem.CoolingDown(Instant.parse("2026-09-25T13:30:00Z")))));
    talk.talk(player, STAN);
    presenter.last().press("Train");
    var screen = presenter.last().screen();
    assertThat(screen.body())
        .isEqualTo(
            """
                Shopkeeper: level 0 of 5.
                That costs 1000 crystals, and you have 250 crystals.
                You trained recently. Come back in 1 hour 30 minutes.\
                """);
    assertThat(screen.buttons()).extracting(button -> button.label()).containsExactly("Close");
  }

  @Test
  void aFailedPurchaseIsExplainedOnTheNextOffer() {
    talk.talk(player, DARREN);
    presenter.last().press("Buy level 1");
    purchases.nextBuy =
        Result.err(
            List.of(
                new PurchaseProblem.QuoteChanged(
                    new Quote(Track.MECHANIC, 1, 1000), new Quote(Track.MECHANIC, 1, 1200))));
    presenter.last().press("Confirm");
    assertThat(presenter.last().screen().body())
        .startsWith("The price changed while you decided; here is the new offer.\n");
  }

  @Test
  void aBrokenQuoteTellsThePlayer() {
    purchases.nextQuote = CompletableFuture.failedFuture(new IllegalStateException("db down"));
    talk.talk(player, DARREN);
    assertThat(presenter.shown).isEmpty();
    assertThat(messages()).containsExactly("[NPCs]: Training is unavailable right now.");
  }

  @Test
  void aQuoteArrivingAfterThePlayerLeftIsDropped() {
    var pending = new CompletableFuture<Result<Quote, List<PurchaseProblem>>>();
    purchases.nextQuote = pending;
    talk.talk(player, DARREN);
    player.disconnect();
    pending.complete(Result.ok(new Quote(Track.MECHANIC, 1, 1000)));
    assertThat(presenter.shown).isEmpty();
  }

  @Test
  void aClickForAnNpcRemovedByReloadCloses() {
    talk.talk(player, STAN);
    catalog.replace(Content.empty());
    presenter.last().press("To about");
    assertThat(presenter.closed).containsExactly(player);
  }

  @Test
  void aProvidedTrainerButtonOnANonTrainerCloses() {
    var odd =
        new DialogueGraph(
            "odd",
            "Braxton",
            "a",
            Map.of("a", choices("Hm", option("Train", new OptionEffect.OpenTrainer()))));
    dialogues.register((who, npc) -> Optional.of(odd));
    talk.talk(player, BRAXTON);
    presenter.last().press("Train");
    assertThat(presenter.closed).containsExactly(player);
    assertThat(purchases.quoted).isEmpty();
  }

  @Test
  void forgettingAPlayerDropsTheirOpenDialog() {
    talk.talk(player, STAN);
    talk.forget(player);
    presenter.last().press("Bye");
    assertThat(presenter.closed).isEmpty();
  }
}
