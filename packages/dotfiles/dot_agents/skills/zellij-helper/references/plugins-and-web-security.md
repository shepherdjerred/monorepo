# Zellij plugins and web security

Read this when loading/building plugins, using plugin pipes, configuring web access, or exporting session/pane content.

## Plugin permissions

Plugins request capabilities. Review command execution, host-disk, pane-content, input interception, reconfiguration, and web-server permissions individually. Full host-disk access materially expands the default mappings.

Remote plugin URLs are executable code distribution. Use a versioned, reviewed artifact with a stable integrity/upgrade process.

## Lifecycle and upgrades

Plugins subscribe to events, issue host commands, persist configuration/data, and use background workers. Upgrade against the current API and permission model; runtime compatibility of compiled artifacts does not guarantee source compatibility.

## Web client

Keep the server on loopback by default. Non-loopback bind requires certificate and key. Add a reverse proxy or equivalent for rate limiting and access policy.

Create a token explicitly and store it once; it cannot be retrieved later. Prefer read-only tokens for viewing and document revocation. Full tokens grant terminal-level authority.

## Sensitive APIs

Screen dumps, scrollback subscriptions, pane JSON, layouts, and resurrection caches can expose terminal contents and commands. Restrict output location and retention.

## Primary documentation

- [Plugins](https://zellij.dev/documentation/plugins.html)
- [Plugin loading](https://zellij.dev/documentation/plugin-loading.html)
- [Plugin API](https://zellij.dev/documentation/plugin-api.html)
- [Plugin events](https://zellij.dev/documentation/plugin-api-events.html)
- [Plugin commands](https://zellij.dev/documentation/plugin-api-commands.html)
- [Plugin types](https://zellij.dev/documentation/plugin-api-types.html)
- [Plugin permissions](https://zellij.dev/documentation/plugin-api-permissions.html)
- [Plugin configuration](https://zellij.dev/documentation/plugin-api-configuration.html)
- [Plugin file system](https://zellij.dev/documentation/plugin-api-file-system.html)
- [Plugin logging](https://zellij.dev/documentation/plugin-api-logging.html)
- [Plugin workers](https://zellij.dev/documentation/plugin-api-workers.html)
- [Plugin pipes](https://zellij.dev/documentation/plugin-pipes.html)
- [Plugin lifecycle](https://zellij.dev/documentation/plugin-lifecycle.html)
- [Plugin upgrading](https://zellij.dev/documentation/plugin-upgrading.html)
- [Plugin aliases](https://zellij.dev/documentation/plugin-aliases.html)
- [Web client](https://zellij.dev/documentation/web-client.html)
- [Compatibility](https://zellij.dev/documentation/compatibility.html)
