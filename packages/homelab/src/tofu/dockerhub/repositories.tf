locals {
  registry = jsondecode(file("${path.module}/../../../../version-catalog/src/image-registry.json"))
  images   = { for image in local.registry.images : image.name => image }
}

resource "docker_hub_repository" "image" {
  for_each = local.images

  namespace   = local.registry.namespace
  name        = each.key
  description = "First-party ${each.key} image from shepherdjerred/monorepo"
  private     = each.value.visibility == "private"

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = local.registry.registry == "docker.io" && local.registry.namespace == "shepherdjerred" && contains(["private", "public"], each.value.visibility)
      error_message = "Docker Hub repositories require the declared personal namespace and explicit visibility."
    }
  }
}
