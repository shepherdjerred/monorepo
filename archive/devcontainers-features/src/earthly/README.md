# Earthly (earthly)

A feature to install Earthly

## Example Usage

```json
"features": {
    "ghcr.io/shepherdjerred/devcontainers-features/earthly:1": {}
}
```

## Options

| Options Id | Description                                          | Type    | Default Value  |
| ---------- | ---------------------------------------------------- | ------- | -------------- |
| version    | The version of Earthly to install                    | string  | latest         |
| location   | The location for the Earthly binary                  | string  | /usr/local/bin |
| bootstrap  | Whether or not to bootstrap Earthly after installing | boolean | true           |

---

_Note: This file was auto-generated from the [devcontainer-feature.json](https://github.com/shepherdjerred/devcontainers-features/blob/main/src/earthly/devcontainer-feature.json). Add additional notes to a `NOTES.md`._
