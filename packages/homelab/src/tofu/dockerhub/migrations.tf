# Arcade replaced the Discord Plays Pokémon and Mario Kart deployments, so
# their images left the registry. OpenTofu forgets the two repositories
# instead of planning a destroy that `prevent_destroy` would refuse; an
# operator deletes them on Docker Hub. `removed` cannot address a for_each
# instance, hence the intermediate moves.
moved {
  from = docker_hub_repository.image["discord-plays-pokemon"]
  to   = docker_hub_repository.retired_discord_plays_pokemon
}

removed {
  from = docker_hub_repository.retired_discord_plays_pokemon

  lifecycle {
    destroy = false
  }
}

moved {
  from = docker_hub_repository.image["discord-plays-mario-kart"]
  to   = docker_hub_repository.retired_discord_plays_mario_kart
}

removed {
  from = docker_hub_repository.retired_discord_plays_mario_kart

  lifecycle {
    destroy = false
  }
}
