import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { getConfig } from "../config/index.js";
import { KNOWLEDGE_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";
import * as comp from "../a2ui/components.js";
import * as msg from "../a2ui/messages.js";
import type { A2UIMessage, UserAction } from "../a2ui/types.js";
import { logger } from "../utils/logger.js";

const TopicResponseSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keyFacts: z.array(z.string()),
  relatedTopics: z.array(z.string()),
});

type TopicResponse = z.infer<typeof TopicResponseSchema>;

export class KnowledgeAgent {
  private anthropic;

  constructor() {
    const config = getConfig();
    this.anthropic = createAnthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  async *exploreTopic(query: string): AsyncGenerator<A2UIMessage> {
    const surfaceId = msg.generateSurfaceId("topic");
    logger.info("Exploring topic", { query, surfaceId });

    // Phase 1: Show loading state
    yield* this.generateLoadingUI(surfaceId);

    // Phase 2: Generate topic content
    try {
      const topicInfo = await this.fetchTopicInfo(query);
      logger.debug("Topic info fetched", { title: topicInfo.title });

      // Phase 3: Stream the topic UI
      yield* this.generateTopicUI(surfaceId, topicInfo);
    } catch (error) {
      logger.error("Failed to fetch topic info", error);
      yield* this.generateErrorUI(surfaceId, query);
    }
  }

  private *generateLoadingUI(surfaceId: string): Generator<A2UIMessage> {
    const components = [
      comp.column("root", ["loading-card"], { alignment: "stretch" }),
      comp.card("loading-card", "loading-content"),
      comp.column("loading-content", ["loading-text", "loading-progress"], {
        alignment: "center",
      }),
      comp.text("loading-text", comp.literal("Exploring topic..."), "body"),
      comp.progressIndicator("loading-progress", comp.literalNumber(0.5)),
    ];

    yield msg.surfaceUpdate(surfaceId, components);
    yield msg.beginRendering(surfaceId, "root");
  }

  private *generateErrorUI(
    surfaceId: string,
    query: string
  ): Generator<A2UIMessage> {
    const components = [
      comp.column("root", ["error-card"], { alignment: "stretch" }),
      comp.card("error-card", "error-content"),
      comp.column("error-content", ["error-icon", "error-title", "error-text", "retry-btn"], {
        alignment: "center",
      }),
      comp.icon("error-icon", "alert-circle"),
      comp.text("error-title", comp.literal("Something went wrong"), "h3"),
      comp.text(
        "error-text",
        comp.literal(`Unable to explore "${query}". Please try again.`),
        "body"
      ),
      comp.button(
        "retry-btn",
        "retry-btn-text",
        comp.action("retry_explore", { query }),
        true
      ),
      comp.text("retry-btn-text", comp.literal("Try Again")),
    ];

    yield msg.surfaceUpdate(surfaceId, components);
    yield msg.beginRendering(surfaceId, "root");
  }

  private async fetchTopicInfo(query: string): Promise<TopicResponse> {
    const config = getConfig();

    const result = await generateText({
      model: this.anthropic(config.anthropic.model),
      system: KNOWLEDGE_AGENT_SYSTEM_PROMPT,
      prompt: `Provide information about: ${query}`,
      maxTokens: 1000,
    });

    // Extract JSON from the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return TopicResponseSchema.parse(parsed);
  }

  private *generateTopicUI(
    surfaceId: string,
    topic: TopicResponse
  ): Generator<A2UIMessage> {
    // Build fact item components dynamically
    const factComponents = topic.keyFacts.flatMap((fact, index) => [
      comp.row(`fact-${index}`, [`fact-icon-${index}`, `fact-text-${index}`], {
        alignment: "center",
      }),
      comp.icon(`fact-icon-${index}`, "check-circle"),
      comp.text(`fact-text-${index}`, comp.literal(fact), "body"),
    ]);

    const factIds = topic.keyFacts.map((_, index) => `fact-${index}`);

    // Build related topic buttons dynamically
    const relatedComponents = topic.relatedTopics.flatMap((related, index) => [
      comp.button(
        `related-btn-${index}`,
        `related-text-${index}`,
        comp.action("explore_topic", { topic: related }),
        false
      ),
      comp.text(`related-text-${index}`, comp.literal(related)),
    ]);

    const relatedBtnIds = topic.relatedTopics.map(
      (_, index) => `related-btn-${index}`
    );

    // Build component tree
    const components = [
      // Root container
      comp.column("root", ["main-card", "related-section"], {
        alignment: "stretch",
      }),

      // Main topic card
      comp.card("main-card", "card-content"),
      comp.column("card-content", [
        "topic-title",
        "divider-1",
        "topic-summary",
        "facts-section",
        "action-buttons",
      ]),

      // Title
      comp.text("topic-title", comp.literal(topic.title), "h1"),
      comp.divider("divider-1"),

      // Summary
      comp.text("topic-summary", comp.literal(topic.summary), "body"),

      // Facts section
      comp.column("facts-section", ["facts-header", ...factIds]),
      comp.text("facts-header", comp.literal("Key Facts"), "h3"),
      ...factComponents,

      // Action buttons
      comp.row("action-buttons", ["btn-details", "btn-ask"], {
        distribution: "spaceEvenly",
      }),

      // Detail button
      comp.button(
        "btn-details",
        "btn-details-text",
        comp.action("expand_details", { topic: topic.title }),
        true
      ),
      comp.text("btn-details-text", comp.literal("Learn More")),

      // Ask button
      comp.button(
        "btn-ask",
        "btn-ask-text",
        comp.action("ask_followup", { topic: topic.title }),
        false
      ),
      comp.text("btn-ask-text", comp.literal("Ask a Question")),

      // Related topics section
      comp.card("related-section", "related-content"),
      comp.column("related-content", ["related-header", "related-list"]),
      comp.text("related-header", comp.literal("Related Topics"), "h3"),
      comp.row("related-list", relatedBtnIds, {
        distribution: "start",
      }),
      ...relatedComponents,
    ];

    yield msg.surfaceUpdate(surfaceId, components);
    yield msg.beginRendering(surfaceId, "root");
  }

  async *handleUserAction(
    action: UserAction["userAction"]
  ): AsyncGenerator<A2UIMessage> {
    logger.info("Handling user action", { name: action.name, context: action.context });

    switch (action.name) {
      case "explore_topic":
      case "retry_explore": {
        const topic = action.context["topic"] as string;
        yield* this.exploreTopic(topic);
        break;
      }

      case "expand_details": {
        const topic = action.context["topic"] as string;
        yield* this.expandDetails(topic, action.surfaceId);
        break;
      }

      case "ask_followup": {
        // For now, just show a prompt to the user
        yield* this.showAskPrompt(action.context["topic"] as string);
        break;
      }

      default:
        logger.warn("Unknown action", { name: action.name });
    }
  }

  private async *expandDetails(
    topic: string,
    _surfaceId: string
  ): AsyncGenerator<A2UIMessage> {
    // Generate a new surface with expanded details
    const detailSurfaceId = msg.generateSurfaceId("details");

    // Show loading
    yield* this.generateLoadingUI(detailSurfaceId);

    try {
      const config = getConfig();

      const result = await generateText({
        model: this.anthropic(config.anthropic.model),
        system: `You are a helpful assistant. Provide a detailed explanation of the topic.
Return JSON with: { "title": "...", "sections": [{ "heading": "...", "content": "..." }] }`,
        prompt: `Provide detailed information about: ${topic}`,
        maxTokens: 2000,
      });

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      const details = JSON.parse(jsonMatch[0]);

      // Build detailed view
      const sectionComponents = details.sections.flatMap(
        (section: { heading: string; content: string }, index: number) => [
          comp.text(`section-heading-${index}`, comp.literal(section.heading), "h3"),
          comp.text(`section-content-${index}`, comp.literal(section.content), "body"),
          comp.divider(`section-divider-${index}`),
        ]
      );

      const sectionIds = details.sections.flatMap(
        (_: unknown, index: number) => [
          `section-heading-${index}`,
          `section-content-${index}`,
          `section-divider-${index}`,
        ]
      );

      const components = [
        comp.column("root", ["details-card"], { alignment: "stretch" }),
        comp.card("details-card", "details-content"),
        comp.column("details-content", [
          "details-title",
          "details-divider",
          ...sectionIds,
          "back-btn",
        ]),
        comp.text("details-title", comp.literal(details.title || topic), "h1"),
        comp.divider("details-divider"),
        ...sectionComponents,
        comp.button(
          "back-btn",
          "back-btn-text",
          comp.action("explore_topic", { topic }),
          false
        ),
        comp.text("back-btn-text", comp.literal("← Back to Overview")),
      ];

      yield msg.surfaceUpdate(detailSurfaceId, components);
      yield msg.beginRendering(detailSurfaceId, "root");
    } catch (error) {
      logger.error("Failed to expand details", error);
      yield* this.generateErrorUI(detailSurfaceId, topic);
    }
  }

  private *showAskPrompt(topic: string): Generator<A2UIMessage> {
    const promptSurfaceId = msg.generateSurfaceId("ask");

    const components = [
      comp.column("root", ["prompt-card"], { alignment: "stretch" }),
      comp.card("prompt-card", "prompt-content"),
      comp.column("prompt-content", ["prompt-title", "prompt-text", "dismiss-btn"], {
        alignment: "center",
      }),
      comp.text("prompt-title", comp.literal("Ask a Question"), "h2"),
      comp.text(
        "prompt-text",
        comp.literal(`Type your question about "${topic}" in the search box above.`),
        "body"
      ),
      comp.button(
        "dismiss-btn",
        "dismiss-btn-text",
        comp.action("explore_topic", { topic }),
        true
      ),
      comp.text("dismiss-btn-text", comp.literal("Got it")),
    ];

    yield msg.surfaceUpdate(promptSurfaceId, components);
    yield msg.beginRendering(promptSurfaceId, "root");
  }
}
