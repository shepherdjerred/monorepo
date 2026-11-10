import { describe, expect, test } from "vitest";
import { GithubProvider } from "#generated/providers/github/provider/index.ts";
import { Repository } from "#generated/providers/github/repository/index.ts";
import {
  adopt,
  forget,
  importInstance,
  moved,
  protect,
  retire,
} from "#src/state-migrations.ts";
import { synthesizeStack } from "#src/testing.ts";

describe("adopting an existing object", () => {
  test("imports it and refuses its destruction, at the construct's own address", async () => {
    const stack = await synthesizeStack((scope) => {
      new GithubProvider(scope, "github", {});
      adopt(
        new Repository(scope, "monorepo", { name: "monorepo" }),
        "monorepo",
      );
    });
    expect(stack.import).toEqual([
      { id: "monorepo", to: "github_repository.monorepo" },
    ]);
    expect(stack.resource?.["github_repository"]?.["monorepo"]).toEqual({
      name: "monorepo",
      lifecycle: { prevent_destroy: true },
    });
  });

  test("prevent_destroy keeps a lifecycle the resource already declares", async () => {
    const stack = await synthesizeStack((scope) => {
      new GithubProvider(scope, "github", {});
      protect(
        new Repository(scope, "monorepo", {
          name: "monorepo",
          lifecycle: { ignoreChanges: ["description"] },
        }),
      );
    });
    expect(
      stack.resource?.["github_repository"]?.["monorepo"]?.["lifecycle"],
    ).toEqual({ ignore_changes: ["description"], prevent_destroy: true });
    expect(stack.import).toBeUndefined();
  });
});

describe("stack-level state migrations", () => {
  test("retiring a for_each instance moves it to an address removed can forget", async () => {
    const stack = await synthesizeStack((scope) => {
      retire(scope, {
        from: 'docker_hub_repository.image["discord-plays-pokemon"]',
        as: "docker_hub_repository.retired_discord_plays_pokemon",
      });
      retire(scope, {
        from: 'docker_hub_repository.image["discord-plays-mario-kart"]',
        as: "docker_hub_repository.retired_discord_plays_mario_kart",
      });
    });
    expect(stack.moved).toEqual([
      {
        from: 'docker_hub_repository.image["discord-plays-pokemon"]',
        to: "docker_hub_repository.retired_discord_plays_pokemon",
      },
      {
        from: 'docker_hub_repository.image["discord-plays-mario-kart"]',
        to: "docker_hub_repository.retired_discord_plays_mario_kart",
      },
    ]);
    expect(stack.removed).toEqual([
      {
        from: "docker_hub_repository.retired_discord_plays_pokemon",
        lifecycle: { destroy: false },
      },
      {
        from: "docker_hub_repository.retired_discord_plays_mario_kart",
        lifecycle: { destroy: false },
      },
    ]);
  });

  test("plain moves, forgotten resources and retirements accumulate in declaration order", async () => {
    const stack = await synthesizeStack((scope) => {
      moved(
        scope,
        'openai_project.managed["buildkite"]',
        'openai_project.managed["woodpecker"]',
      );
      forget(scope, "github_repository_webhook.buildkite");
      retire(scope, {
        from: 'openai_project.managed["openrouter"]',
        as: "openai_project.retired_openrouter",
      });
    });
    expect(stack.moved).toEqual([
      {
        from: 'openai_project.managed["buildkite"]',
        to: 'openai_project.managed["woodpecker"]',
      },
      {
        from: 'openai_project.managed["openrouter"]',
        to: "openai_project.retired_openrouter",
      },
    ]);
    expect(stack.removed).toEqual([
      {
        from: "github_repository_webhook.buildkite",
        lifecycle: { destroy: false },
      },
      {
        from: "openai_project.retired_openrouter",
        lifecycle: { destroy: false },
      },
    ]);
  });

  test("two stacks keep separate lists", async () => {
    const first = await synthesizeStack((scope) => {
      forget(scope, "a.b");
    });
    const second = await synthesizeStack((scope) => {
      forget(scope, "c.d");
    });
    expect(first.removed).toEqual([
      { from: "a.b", lifecycle: { destroy: false } },
    ]);
    expect(second.removed).toEqual([
      { from: "c.d", lifecycle: { destroy: false } },
    ]);
  });

  test("rejects a retirement that removed could not express", async () => {
    await expect(
      synthesizeStack((scope) => {
        retire(scope, { from: "a.whole", as: "a.retired" });
      }),
    ).rejects.toThrow("forget() it instead");
    await expect(
      synthesizeStack((scope) => {
        retire(scope, { from: 'a.each["k"]', as: 'a.retired["k"]' });
      }),
    ).rejects.toThrow("whole-resource address");
  });
});

describe("importing a for_each instance", () => {
  test("writes the instance's import block next to a resource's own import", async () => {
    const stack = await synthesizeStack((scope) => {
      new GithubProvider(scope, "github", {});
      adopt(
        new Repository(scope, "monorepo", { name: "monorepo" }),
        "monorepo",
      );
      importInstance(
        scope,
        'docker_hub_repository.image["delivery"]',
        "shepherdjerred/delivery",
      );
      importInstance(
        scope,
        'docker_hub_repository.image["media"]',
        "shepherdjerred/media",
      );
    });
    expect(stack.import).toEqual([
      { id: "monorepo", to: "github_repository.monorepo" },
      {
        id: "shepherdjerred/delivery",
        to: 'docker_hub_repository.image["delivery"]',
      },
      {
        id: "shepherdjerred/media",
        to: 'docker_hub_repository.image["media"]',
      },
    ]);
  });

  test("refuses a whole resource, which importFrom() addresses", async () => {
    await expect(
      synthesizeStack((scope) => {
        importInstance(scope, "docker_hub_repository.image", "x/y");
      }),
    ).rejects.toThrow("use importFrom() or adopt()");
  });
});
