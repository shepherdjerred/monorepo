---
title: Roll out The Storm staff tools and letters
description: Rehearse staff permissions and letters, coordinate PROXY protocol routing, and enable IP enforcement only after address verification.
---

Rehearse the command surface on a disposable server, coordinate the routing change, then enable each capability after live acceptance.

Use the [command and permission contract](https://github.com/shepherdjerred/monorepo/blob/main/packages/the-storm/README.md) for commands, limits and rollout keys.

1. Build the plugin and server image through the repository workflow. Run the focused Java checks and real Paper expansion suite. Verify silent starter supplies, player warp restrictions, letter ownership, literal book rendering, staff inventory edits, vanish and confirmation behavior.

2. Exercise staff roles with their intended LuckPerms nodes rather than OP alone. Verify ordinary players cannot invoke staff commands. Verify inventory inspection cannot transfer items until editing is explicitly authorized. Verify removing a permission stops the associated action.

3. Rehearse jail release and timed expiry across reconnects. Confirm the return location, retained communication and blocked travel. Set runtime destinations only while standing at safe locations. Restart and confirm the destinations survive without changing owned YAML.

4. Schedule a maintenance window for the routing cutover. Stop admitting new connections and drain active sessions before changing protocol expectations. Release the Storm and Shuxin Paper backends, Geyser settings, RLCraft header adapter, network policies and mc-router configuration as one coordinated change through GitOps. Follow [the root release workflow](/how-to/cut-a-homelab-release/) for reconciliation.

5. Confirm ArgoCD reconciles the intended revisions and every awake backend becomes healthy. Exercise Java hostname routing and wake-on-join for each backend. Confirm RLCraft accepts ordinary Forge traffic through its header adapter. Route public TCP and Bedrock UDP to nodes with local service endpoints after enabling source preservation.

6. Join Storm with a Java client and a Bedrock client using different public addresses. Keep IP enforcement disabled until both trusted paths report the actual client address. Verify direct gameplay access to the backend is blocked. Rehearse public-address bans and temporary expiry on disposable accounts before enabling enforcement.

7. Enable staff tools, identity and letters through managed targeting after accepting their behavior. Enable IP enforcement separately after accepting routing and both client paths. Confirm existing reward claims still work and a full letter inbox refuses new mail without deleting older letters.

8. If gameplay acceptance fails, turn off the affected capability through managed targeting. If routing fails, stop admissions and roll back router forwarding, Paper expectations, Geyser forwarding, header-adapter routing and network policy to the previously accepted revisions together. Keep IP enforcement disabled. Recheck Java, Bedrock, RLCraft and wake-on-join before reopening admissions.

## Related

- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
- [Run a Minecraft sandbox in the cluster](/how-to/run-a-minecraft-sandbox-in-the-cluster/)
