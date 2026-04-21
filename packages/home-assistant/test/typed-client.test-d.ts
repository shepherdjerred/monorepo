/**
 * Compile-time type tests for the schema-parameterized clients. This file is
 * included in typecheck (via tsconfig `include: ["test/**\/*"]`) but has no
 * runtime assertions — the `@ts-expect-error` comments fail the build when
 * the expected errors disappear, and valid lines must compile clean. Renamed
 * to `.test-d.ts` by convention so it's obvious it's a type-level test and
 * so bun test doesn't try to run it as a suite.
 */

import type { HomeAssistantRestClient } from "#lib";

type DemoSchema = {
  entities: {
    "light.kitchen": {
      domain: "light";
      attributes: { brightness: 0; color_mode: "" };
    };
    "light.bedroom": { domain: "light"; attributes: Record<string, never> };
    "media_player.bedroom": {
      domain: "media_player";
      attributes: { volume_level: 0 };
    };
    "switch.entry": { domain: "switch"; attributes: Record<string, never> };
  };
  services: {
    light: {
      turn_on: {
        fields: {
          brightness: { type: "number"; required: false };
          transition: { type: "number"; required: false };
        };
        target: { domain: "light" };
      };
      turn_off: {
        fields: { transition: { type: "number"; required: false } };
        target: { domain: "light" };
      };
    };
    media_player: {
      volume_set: {
        fields: { volume_level: { type: "number"; required: true } };
        target: { domain: "media_player" };
      };
    };
    notify: {
      notify: {
        fields: {
          title: { type: "string"; required: false };
          message: { type: "string"; required: true };
        };
      };
    };
  };
  events: "state_changed" | "automation_triggered";
  eventData: {
    state_changed: {
      entity_id: string;
      old_state: unknown;
      new_state: unknown;
    };
  };
};

declare const ha: HomeAssistantRestClient<DemoSchema>;

export async function valid(): Promise<void> {
  await ha.getState("light.kitchen");
  await ha.getState("media_player.bedroom");

  await ha.callService("light", "turn_on", {
    entity_id: "light.kitchen",
    brightness: 200,
  });
  await ha.callService("light", "turn_on", {
    entity_id: ["light.kitchen", "light.bedroom"],
  });
  await ha.callService("light", "turn_off", { entity_id: "light.bedroom" });
  await ha.callService("media_player", "volume_set", {
    entity_id: "media_player.bedroom",
    volume_level: 0.5,
  });
  await ha.callService("notify", "notify", { message: "hello" });

  await ha.fireEvent("state_changed", {
    entity_id: "x",
    old_state: null,
    new_state: null,
  });
}

export async function invalid(): Promise<void> {
  // @ts-expect-error — entity ID not in schema
  await ha.getState("light.kitcen");

  // @ts-expect-error — wrong domain
  await ha.callService("lite", "turn_on", {});

  // @ts-expect-error — wrong service under a valid domain
  await ha.callService("light", "turn_of", {});

  await ha.callService("light", "turn_on", {
    // @ts-expect-error — entity_id is not a light
    entity_id: "media_player.bedroom",
  });

  // @ts-expect-error — volume_level is required for media_player.volume_set
  await ha.callService("media_player", "volume_set", {
    entity_id: "media_player.bedroom",
  });

  await ha.callService(
    "notify",
    "notify",
    // @ts-expect-error — `message` is required for notify.notify
    { title: "no body" },
  );

  // @ts-expect-error — unknown event type
  await ha.fireEvent("never_fired_event");
}

/**
 * The default (unparameterized) client keeps loose typing so existing call
 * sites compile unchanged.
 */
declare const haDefault: HomeAssistantRestClient;

export async function defaultIsLoose(): Promise<void> {
  await haDefault.getState("anything.goes");
  await haDefault.callService("any-domain", "any-service", {
    entity_id: "whatever.thing",
    arbitrary: 123,
  });
  await haDefault.fireEvent("some_event", { payload: 1 });
}
