import type { Construct } from "constructs";
import { Fn, Op, TerraformIterator, TerraformLocal, Token, ref } from "cdktn";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
import { DockerProvider } from "#generated/providers/docker/provider/index.ts";
import { HubRepository } from "#generated/providers/docker/hub-repository/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { importInstance, retire } from "#src/state-migrations.ts";

/**
 * First-party repositories in the personal `shepherdjerred` Docker Hub
 * namespace, one per image in the version catalog's image registry. See
 * `src/tofu/dockerhub/README.md`.
 */
export class DockerhubStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "dockerhub", {
      requiredVersion: ">= 1.11.0",
      providerConstraints: { docker: "0.7.0" },
    });

    encryptStateAndPlans(this, {
      description: "Passphrase encrypting Docker Hub state and plans.",
      errorMessage:
        "The state encryption passphrase must contain at least 16 characters.",
    });

    // DOCKER_USERNAME and DOCKER_PASSWORD are isolated by the stack wrapper.
    new DockerProvider(this, "docker");

    // The registry is imported rather than read with file(), so a registry
    // change reaches the stack through a re-synthesis that review sees.
    new TerraformLocal(this, "registry", imageRegistry);
    const images = new TerraformLocal(
      this,
      "images",
      "${{ for image in local.registry.images : image.name => image }}",
    );

    // A raw "${local.…}" string passed to Op or Fn would be escaped.
    const registryRegistry = ref("local.registry.registry");
    const registryNamespace = ref("local.registry.namespace");

    const image = TerraformIterator.fromMap(images.asAnyMap);
    const visibility = image.getString("visibility");
    new HubRepository(this, "image", {
      forEach: image,
      namespace: Token.asString(registryNamespace),
      name: image.key,
      description: `First-party ${image.key} image from shepherdjerred/monorepo`,
      private: Op.eq(visibility, "private"),
      lifecycle: {
        preventDestroy: true,
        precondition: [
          {
            condition: Op.and(
              Op.and(
                Op.eq(registryRegistry, "docker.io"),
                Op.eq(registryNamespace, "shepherdjerred"),
              ),
              Fn.contains(["private", "public"], visibility),
            ),
            errorMessage:
              "Docker Hub repositories require the declared personal namespace and explicit visibility.",
          },
        ],
      },
    });

    importInstance(
      this,
      'docker_hub_repository.image["delivery"]',
      "shepherdjerred/delivery",
    );
    importInstance(
      this,
      'docker_hub_repository.image["media"]',
      "shepherdjerred/media",
    );

    // Arcade replaced the Discord Plays Pokémon and Mario Kart deployments,
    // so their images left the registry. OpenTofu forgets the two
    // repositories instead of planning a destroy that `prevent_destroy` would
    // refuse; an operator deletes them on Docker Hub.
    retire(this, {
      from: 'docker_hub_repository.image["discord-plays-pokemon"]',
      as: "docker_hub_repository.retired_discord_plays_pokemon",
    });
    retire(this, {
      from: 'docker_hub_repository.image["discord-plays-mario-kart"]',
      as: "docker_hub_repository.retired_discord_plays_mario_kart",
    });
  }
}
