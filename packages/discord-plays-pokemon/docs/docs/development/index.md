# Development

## Requirements

- [NodeJS LTS (18.x)](https://nodejs.org/en)
- [Earthly](https://earthly.dev/get-earthly)
- [Docker](https://www.docker.com/products/docker-desktop/)

## Structure

This project is structured as follows:

```text
docs/
packages/
├─ backend/
├─ common/
├─ frontend/
```

## Using Earthly

You can build the source code by running `earthly +build`. This will build the frontend, backend, documentation, and common components. A Docker image can be created by running `earthly +image`.

!!! note

    Earthly automatically tracks dependencies and performs necessary ordering, caching, parallelization, etc. You don't ever need to run one target before another.

`earthly +up` and `earthly +down` can be used to build and start the project.

The root Earthfile has more targets, which can be listed by running `earthly +ls`.

## Without Earthly

Sometimes it is useful to not be working with a container. In this case, you can build the project directly on your machine.

1. Run `npm i` in the root the repository
2. Run `npm run build --workspaces`

## Testing Changes

Manually testing changes can be achieved by running the application. It is easiest to do this if you first edit your `config.toml` to disable features that require a GPU or web browser, if possible.
