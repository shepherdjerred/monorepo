import * as graphql_request from 'graphql-request';
import { GraphQLClient, ClientError } from 'graphql-request';
export { GraphQLClient } from 'graphql-request';
import * as opentelemetry from '@opentelemetry/api';
import { GraphQLErrorExtensions } from 'graphql';
import { Writable } from 'node:stream';

/**
 * Tracer encapsulates the OpenTelemetry Tracer.
 */
declare class Tracer {
    private tracer;
    constructor(name: string);
    startSpan(name: string, attributes?: opentelemetry.Attributes): opentelemetry.Span;
    /**
     * Execute the functions with a custom span with the given name using startActiveSpan.
     * The function executed will use the parent context of the function (it can be another span
     * or the main function).
     *
     * @param name The name of the span
     * @param fn The functions to execute
     *
     * startActiveSpan returns the result of the executed functions.
     *
     * The span is automatically ended when the function is done.
     * The span is automatically marked as an error if the function throws an error.
     *
     *
     * @example
     * ```
     * return getTracer().startActiveSpan(name, async () => {
     *   return this.containerEcho("test").stdout()
     * })
     * ```
     */
    startActiveSpan<T>(name: string, fn: (span: opentelemetry.Span) => Promise<T>, attributes?: opentelemetry.Attributes): Promise<T>;
}

/**
 * Return a tracer to use with Dagger.
 *
 * The tracer is automatically initialized if not already done.
 * As a conveniance function, you can use `withTracingSpan` that automatically close
 * the span at the end of the function.
 *
 * You can add a custom name to the tracer based on your application.
 */
declare function getTracer(name?: string): Tracer;

/**
 * Wraps the GraphQL client to allow lazy initialization and setting
 * the GQL client of the global Dagger client instance (`dag`).
 */
declare class Connection {
    private _gqlClient?;
    constructor(_gqlClient?: GraphQLClient | undefined);
    resetClient(): void;
    setGQLClient(gqlClient: GraphQLClient): void;
    getGQLClient(): GraphQLClient;
}

type QueryTree = {
    operation: string;
    args?: Record<string, unknown>;
};

declare class Context {
    private _queryTree;
    private _connection;
    constructor(_queryTree?: QueryTree[], _connection?: Connection);
    getGQLClient(): GraphQLClient;
    copy(): Context;
    select(operation: string, args?: Record<string, unknown>): Context;
    execute<T>(): Promise<T>;
}

/**
 * Declare a number as float in the Dagger API.
 */
type float = number;
declare class BaseClient {
    protected _ctx: Context;
    /**
     * @hidden
     */
    constructor(_ctx?: Context);
}
/**
 * The `BindingID` scalar type represents an identifier for an object of type Binding.
 */
type BindingID = string & {
    __BindingID: never;
};
type BuildArg = {
    /**
     * The build argument name.
     */
    name: string;
    /**
     * The build argument value.
     */
    value: string;
};
/**
 * Sharing mode of the cache volume.
 */
declare enum CacheSharingMode {
    /**
     * Shares the cache volume amongst many build pipelines, but will serialize the writes
     */
    Locked = "LOCKED",
    /**
     * Keeps a cache volume for a single build pipeline
     */
    Private = "PRIVATE",
    /**
     * Shares the cache volume amongst many build pipelines
     */
    Shared = "SHARED"
}
/**
 * The `CacheVolumeID` scalar type represents an identifier for an object of type CacheVolume.
 */
type CacheVolumeID = string & {
    __CacheVolumeID: never;
};
/**
 * The `CloudID` scalar type represents an identifier for an object of type Cloud.
 */
type CloudID = string & {
    __CloudID: never;
};
type ContainerAsServiceOpts = {
    /**
     * Command to run instead of the container's default command (e.g., ["go", "run", "main.go"]).
     *
     * If empty, the container's default command is used.
     */
    args?: string[];
    /**
     * If the container has an entrypoint, prepend it to the args.
     */
    useEntrypoint?: boolean;
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    insecureRootCapabilities?: boolean;
    /**
     * Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
    /**
     * If set, skip the automatic init process injected into containers by default.
     *
     * This should only be used if the user requires that their exec process be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    noInit?: boolean;
};
type ContainerAsTarballOpts = {
    /**
     * Identifiers for other platform specific containers.
     *
     * Used for multi-platform images.
     */
    platformVariants?: Container[];
    /**
     * Force each layer of the image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     */
    forcedCompression?: ImageLayerCompression;
    /**
     * Use the specified media types for the image's layers.
     *
     * Defaults to OCI, which is largely compatible with most recent container runtimes, but Docker may be needed for older runtimes without OCI support.
     */
    mediaTypes?: ImageMediaTypes;
};
type ContainerBuildOpts = {
    /**
     * Path to the Dockerfile to use.
     */
    dockerfile?: string;
    /**
     * Target build stage to build.
     */
    target?: string;
    /**
     * Additional build arguments.
     */
    buildArgs?: BuildArg[];
    /**
     * Secrets to pass to the build.
     *
     * They will be mounted at /run/secrets/[secret-name] in the build container
     *
     * They can be accessed in the Dockerfile using the "secret" mount type and mount path /run/secrets/[secret-name], e.g. RUN --mount=type=secret,id=my-secret curl [http://example.com?token=$(cat /run/secrets/my-secret)](http://example.com?token=$(cat /run/secrets/my-secret))
     */
    secrets?: Secret[];
    /**
     * If set, skip the automatic init process injected into containers created by RUN statements.
     *
     * This should only be used if the user requires that their exec processes be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    noInit?: boolean;
};
type ContainerDirectoryOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerExportOpts = {
    /**
     * Identifiers for other platform specific containers.
     *
     * Used for multi-platform image.
     */
    platformVariants?: Container[];
    /**
     * Force each layer of the exported image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     */
    forcedCompression?: ImageLayerCompression;
    /**
     * Use the specified media types for the exported image's layers.
     *
     * Defaults to OCI, which is largely compatible with most recent container runtimes, but Docker may be needed for older runtimes without OCI support.
     */
    mediaTypes?: ImageMediaTypes;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerFileOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerImportOpts = {
    /**
     * Identifies the tag to import from the archive, if the archive bundles multiple tags.
     */
    tag?: string;
};
type ContainerPublishOpts = {
    /**
     * Identifiers for other platform specific containers.
     *
     * Used for multi-platform image.
     */
    platformVariants?: Container[];
    /**
     * Force each layer of the published image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     */
    forcedCompression?: ImageLayerCompression;
    /**
     * Use the specified media types for the published image's layers.
     *
     * Defaults to "OCI", which is compatible with most recent registries, but "Docker" may be needed for older registries without OCI support.
     */
    mediaTypes?: ImageMediaTypes;
};
type ContainerTerminalOpts = {
    /**
     * If set, override the container's default terminal command and invoke these command arguments instead.
     */
    cmd?: string[];
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    insecureRootCapabilities?: boolean;
};
type ContainerUpOpts = {
    /**
     * Bind each tunnel port to a random port on the host.
     */
    random?: boolean;
    /**
     * List of frontend/backend port mappings to forward.
     *
     * Frontend is the port accepting traffic on the host, backend is the service port.
     */
    ports?: PortForward[];
    /**
     * Command to run instead of the container's default command (e.g., ["go", "run", "main.go"]).
     *
     * If empty, the container's default command is used.
     */
    args?: string[];
    /**
     * If the container has an entrypoint, prepend it to the args.
     */
    useEntrypoint?: boolean;
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    insecureRootCapabilities?: boolean;
    /**
     * Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
    /**
     * If set, skip the automatic init process injected into containers by default.
     *
     * This should only be used if the user requires that their exec process be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    noInit?: boolean;
};
type ContainerWithDefaultTerminalCmdOpts = {
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    insecureRootCapabilities?: boolean;
};
type ContainerWithDirectoryOpts = {
    /**
     * Patterns to exclude in the written directory (e.g. ["node_modules/**", ".gitignore", ".git/"]).
     */
    exclude?: string[];
    /**
     * Patterns to include in the written directory (e.g. ["*.go", "go.mod", "go.sum"]).
     */
    include?: string[];
    /**
     * A user:group to set for the directory and its contents.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithEntrypointOpts = {
    /**
     * Don't reset the default arguments when setting the entrypoint. By default it is reset, since entrypoint and default args are often tightly coupled.
     */
    keepDefaultArgs?: boolean;
};
type ContainerWithEnvVariableOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value according to the current environment variables defined in the container (e.g. "/opt/bin:$PATH").
     */
    expand?: boolean;
};
type ContainerWithExecOpts = {
    /**
     * Apply the OCI entrypoint, if present, by prepending it to the args. Ignored by default.
     */
    useEntrypoint?: boolean;
    /**
     * Content to write to the command's standard input. Example: "Hello world")
     */
    stdin?: string;
    /**
     * Redirect the command's standard output to a file in the container. Example: "./stdout.txt"
     */
    redirectStdout?: string;
    /**
     * Like redirectStdout, but for standard error
     */
    redirectStderr?: string;
    /**
     * Exit codes this command is allowed to exit with without error
     */
    expect?: ReturnType;
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. Like --privileged in Docker
     *
     * DANGER: this grants the command full access to the host system. Only use when 1) you trust the command being executed and 2) you specifically need this level of access.
     */
    insecureRootCapabilities?: boolean;
    /**
     * Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
    /**
     * Skip the automatic init process injected into containers by default.
     *
     * Only use this if you specifically need the command to be pid 1 in the container. Otherwise it may result in unexpected behavior. If you're not sure, you don't need this.
     */
    noInit?: boolean;
};
type ContainerWithExposedPortOpts = {
    /**
     * Network protocol. Example: "tcp"
     */
    protocol?: NetworkProtocol;
    /**
     * Port description. Example: "payment API endpoint"
     */
    description?: string;
    /**
     * Skip the health check when run as a service.
     */
    experimentalSkipHealthcheck?: boolean;
};
type ContainerWithFileOpts = {
    /**
     * Permissions of the new file. Example: 0600
     */
    permissions?: number;
    /**
     * A user:group to set for the file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithFilesOpts = {
    /**
     * Permission given to the copied files (e.g., 0600).
     */
    permissions?: number;
    /**
     * A user:group to set for the files.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithMountedCacheOpts = {
    /**
     * Identifier of the directory to use as the cache volume's root.
     */
    source?: Directory;
    /**
     * Sharing mode of the cache volume.
     */
    sharing?: CacheSharingMode;
    /**
     * A user:group to set for the mounted cache directory.
     *
     * Note that this changes the ownership of the specified mount along with the initial filesystem provided by source (if any). It does not have any effect if/when the cache has already been created.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithMountedDirectoryOpts = {
    /**
     * A user:group to set for the mounted directory and its contents.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithMountedFileOpts = {
    /**
     * A user or user:group to set for the mounted file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithMountedSecretOpts = {
    /**
     * A user:group to set for the mounted secret.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Permission given to the mounted secret (e.g., 0600).
     *
     * This option requires an owner to be set to be active.
     */
    mode?: number;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithMountedTempOpts = {
    /**
     * Size of the temporary directory in bytes.
     */
    size?: number;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithNewFileOpts = {
    /**
     * Permissions of the new file. Example: 0600
     */
    permissions?: number;
    /**
     * A user:group to set for the file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithSymlinkOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithUnixSocketOpts = {
    /**
     * A user:group to set for the mounted socket.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     */
    owner?: string;
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithWorkdirOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithoutDirectoryOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithoutEntrypointOpts = {
    /**
     * Don't remove the default arguments when unsetting the entrypoint.
     */
    keepDefaultArgs?: boolean;
};
type ContainerWithoutExposedPortOpts = {
    /**
     * Port protocol to unexpose
     */
    protocol?: NetworkProtocol;
};
type ContainerWithoutFileOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithoutFilesOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of paths according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    expand?: boolean;
};
type ContainerWithoutMountOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
type ContainerWithoutUnixSocketOpts = {
    /**
     * Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    expand?: boolean;
};
/**
 * The `ContainerID` scalar type represents an identifier for an object of type Container.
 */
type ContainerID = string & {
    __ContainerID: never;
};
type CurrentModuleWorkdirOpts = {
    /**
     * Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     */
    exclude?: string[];
    /**
     * Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     */
    include?: string[];
};
/**
 * The `CurrentModuleID` scalar type represents an identifier for an object of type CurrentModule.
 */
type CurrentModuleID = string & {
    __CurrentModuleID: never;
};
type DirectoryAsModuleOpts = {
    /**
     * An optional subpath of the directory which contains the module's configuration file.
     *
     * If not set, the module source code is loaded from the root of the directory.
     */
    sourceRootPath?: string;
};
type DirectoryAsModuleSourceOpts = {
    /**
     * An optional subpath of the directory which contains the module's configuration file.
     *
     * If not set, the module source code is loaded from the root of the directory.
     */
    sourceRootPath?: string;
};
type DirectoryDockerBuildOpts = {
    /**
     * Path to the Dockerfile to use (e.g., "frontend.Dockerfile").
     */
    dockerfile?: string;
    /**
     * The platform to build.
     */
    platform?: Platform;
    /**
     * Build arguments to use in the build.
     */
    buildArgs?: BuildArg[];
    /**
     * Target build stage to build.
     */
    target?: string;
    /**
     * Secrets to pass to the build.
     *
     * They will be mounted at /run/secrets/[secret-name].
     */
    secrets?: Secret[];
    /**
     * If set, skip the automatic init process injected into containers created by RUN statements.
     *
     * This should only be used if the user requires that their exec processes be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    noInit?: boolean;
};
type DirectoryEntriesOpts = {
    /**
     * Location of the directory to look at (e.g., "/src").
     */
    path?: string;
};
type DirectoryExportOpts = {
    /**
     * If true, then the host directory will be wiped clean before exporting so that it exactly matches the directory being exported; this means it will delete any files on the host that aren't in the exported dir. If false (the default), the contents of the directory will be merged with any existing contents of the host directory, leaving any existing files on the host that aren't in the exported directory alone.
     */
    wipe?: boolean;
};
type DirectoryFilterOpts = {
    /**
     * If set, paths matching one of these glob patterns is excluded from the new snapshot. Example: ["node_modules/", ".git*", ".env"]
     */
    exclude?: string[];
    /**
     * If set, only paths matching one of these glob patterns is included in the new snapshot. Example: (e.g., ["app/", "package.*"]).
     */
    include?: string[];
};
type DirectoryTerminalOpts = {
    /**
     * If set, override the default container used for the terminal.
     */
    container?: Container;
    /**
     * If set, override the container's default terminal command and invoke these command arguments instead.
     */
    cmd?: string[];
    /**
     * Provides Dagger access to the executed command.
     */
    experimentalPrivilegedNesting?: boolean;
    /**
     * Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    insecureRootCapabilities?: boolean;
};
type DirectoryWithDirectoryOpts = {
    /**
     * Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     */
    exclude?: string[];
    /**
     * Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     */
    include?: string[];
};
type DirectoryWithFileOpts = {
    /**
     * Permission given to the copied file (e.g., 0600).
     */
    permissions?: number;
};
type DirectoryWithFilesOpts = {
    /**
     * Permission given to the copied files (e.g., 0600).
     */
    permissions?: number;
};
type DirectoryWithNewDirectoryOpts = {
    /**
     * Permission granted to the created directory (e.g., 0777).
     */
    permissions?: number;
};
type DirectoryWithNewFileOpts = {
    /**
     * Permissions of the new file. Example: 0600
     */
    permissions?: number;
};
/**
 * The `DirectoryID` scalar type represents an identifier for an object of type Directory.
 */
type DirectoryID = string & {
    __DirectoryID: never;
};
type EngineCacheEntrySetOpts = {
    key?: string;
};
type EngineCachePruneOpts = {
    /**
     * Use the engine-wide default pruning policy if true, otherwise prune the whole cache of any releasable entries.
     */
    useDefaultPolicy?: boolean;
};
/**
 * The `EngineCacheEntryID` scalar type represents an identifier for an object of type EngineCacheEntry.
 */
type EngineCacheEntryID = string & {
    __EngineCacheEntryID: never;
};
/**
 * The `EngineCacheEntrySetID` scalar type represents an identifier for an object of type EngineCacheEntrySet.
 */
type EngineCacheEntrySetID = string & {
    __EngineCacheEntrySetID: never;
};
/**
 * The `EngineCacheID` scalar type represents an identifier for an object of type EngineCache.
 */
type EngineCacheID = string & {
    __EngineCacheID: never;
};
/**
 * The `EngineID` scalar type represents an identifier for an object of type Engine.
 */
type EngineID = string & {
    __EngineID: never;
};
/**
 * The `EnumTypeDefID` scalar type represents an identifier for an object of type EnumTypeDef.
 */
type EnumTypeDefID = string & {
    __EnumTypeDefID: never;
};
/**
 * The `EnumValueTypeDefID` scalar type represents an identifier for an object of type EnumValueTypeDef.
 */
type EnumValueTypeDefID = string & {
    __EnumValueTypeDefID: never;
};
/**
 * The `EnvID` scalar type represents an identifier for an object of type Env.
 */
type EnvID = string & {
    __EnvID: never;
};
/**
 * The `EnvVariableID` scalar type represents an identifier for an object of type EnvVariable.
 */
type EnvVariableID = string & {
    __EnvVariableID: never;
};
/**
 * The `ErrorID` scalar type represents an identifier for an object of type Error.
 */
type ErrorID = string & {
    __ErrorID: never;
};
/**
 * The `ErrorValueID` scalar type represents an identifier for an object of type ErrorValue.
 */
type ErrorValueID = string & {
    __ErrorValueID: never;
};
/**
 * The `FieldTypeDefID` scalar type represents an identifier for an object of type FieldTypeDef.
 */
type FieldTypeDefID = string & {
    __FieldTypeDefID: never;
};
type FileDigestOpts = {
    /**
     * If true, exclude metadata from the digest.
     */
    excludeMetadata?: boolean;
};
type FileExportOpts = {
    /**
     * If allowParentDirPath is true, the path argument can be a directory path, in which case the file will be created in that directory.
     */
    allowParentDirPath?: boolean;
};
/**
 * The `FileID` scalar type represents an identifier for an object of type File.
 */
type FileID = string & {
    __FileID: never;
};
type FunctionWithArgOpts = {
    /**
     * A doc string for the argument, if any
     */
    description?: string;
    /**
     * A default value to use for this argument if not explicitly set by the caller, if any
     */
    defaultValue?: JSON;
    /**
     * If the argument is a Directory or File type, default to load path from context directory, relative to root directory.
     */
    defaultPath?: string;
    /**
     * Patterns to ignore when loading the contextual argument value.
     */
    ignore?: string[];
    /**
     * The source map for the argument definition.
     */
    sourceMap?: SourceMap;
};
/**
 * The `FunctionArgID` scalar type represents an identifier for an object of type FunctionArg.
 */
type FunctionArgID = string & {
    __FunctionArgID: never;
};
/**
 * The `FunctionCallArgValueID` scalar type represents an identifier for an object of type FunctionCallArgValue.
 */
type FunctionCallArgValueID = string & {
    __FunctionCallArgValueID: never;
};
/**
 * The `FunctionCallID` scalar type represents an identifier for an object of type FunctionCall.
 */
type FunctionCallID = string & {
    __FunctionCallID: never;
};
/**
 * The `FunctionID` scalar type represents an identifier for an object of type Function.
 */
type FunctionID = string & {
    __FunctionID: never;
};
/**
 * The `GeneratedCodeID` scalar type represents an identifier for an object of type GeneratedCode.
 */
type GeneratedCodeID = string & {
    __GeneratedCodeID: never;
};
type GitRefTreeOpts = {
    /**
     * Set to true to discard .git directory.
     */
    discardGitDir?: boolean;
    /**
     * The depth of the tree to fetch.
     */
    depth?: number;
};
/**
 * The `GitRefID` scalar type represents an identifier for an object of type GitRef.
 */
type GitRefID = string & {
    __GitRefID: never;
};
type GitRepositoryBranchesOpts = {
    /**
     * Glob patterns (e.g., "refs/tags/v*").
     */
    patterns?: string[];
};
type GitRepositoryTagsOpts = {
    /**
     * Glob patterns (e.g., "refs/tags/v*").
     */
    patterns?: string[];
};
/**
 * The `GitRepositoryID` scalar type represents an identifier for an object of type GitRepository.
 */
type GitRepositoryID = string & {
    __GitRepositoryID: never;
};
type HostDirectoryOpts = {
    /**
     * Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     */
    exclude?: string[];
    /**
     * Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     */
    include?: string[];
    /**
     * If true, the directory will always be reloaded from the host.
     */
    noCache?: boolean;
};
type HostFileOpts = {
    /**
     * If true, the file will always be reloaded from the host.
     */
    noCache?: boolean;
};
type HostServiceOpts = {
    /**
     * Upstream host to forward traffic to.
     */
    host?: string;
};
type HostTunnelOpts = {
    /**
     * Map each service port to the same port on the host, as if the service were running natively.
     *
     * Note: enabling may result in port conflicts.
     */
    native?: boolean;
    /**
     * Configure explicit port forwarding rules for the tunnel.
     *
     * If a port's frontend is unspecified or 0, a random port will be chosen by the host.
     *
     * If no ports are given, all of the service's ports are forwarded. If native is true, each port maps to the same port on the host. If native is false, each port maps to a random port chosen by the host.
     *
     * If ports are given and native is true, the ports are additive.
     */
    ports?: PortForward[];
};
/**
 * The `HostID` scalar type represents an identifier for an object of type Host.
 */
type HostID = string & {
    __HostID: never;
};
/**
 * Compression algorithm to use for image layers.
 */
declare enum ImageLayerCompression {
    Estargz = "EStarGZ",
    Gzip = "Gzip",
    Uncompressed = "Uncompressed",
    Zstd = "Zstd"
}
/**
 * Mediatypes to use in published or exported image metadata.
 */
declare enum ImageMediaTypes {
    Docker = "DOCKER",
    Dockermediatypes = "DockerMediaTypes",
    Oci = "OCI",
    Ocimediatypes = "OCIMediaTypes"
}
/**
 * The `InputTypeDefID` scalar type represents an identifier for an object of type InputTypeDef.
 */
type InputTypeDefID = string & {
    __InputTypeDefID: never;
};
/**
 * The `InterfaceTypeDefID` scalar type represents an identifier for an object of type InterfaceTypeDef.
 */
type InterfaceTypeDefID = string & {
    __InterfaceTypeDefID: never;
};
/**
 * An arbitrary JSON-encoded value.
 */
type JSON = string & {
    __JSON: never;
};
/**
 * The `LLMID` scalar type represents an identifier for an object of type LLM.
 */
type LLMID = string & {
    __LLMID: never;
};
/**
 * The `LLMTokenUsageID` scalar type represents an identifier for an object of type LLMTokenUsage.
 */
type LLMTokenUsageID = string & {
    __LLMTokenUsageID: never;
};
/**
 * The `LabelID` scalar type represents an identifier for an object of type Label.
 */
type LabelID = string & {
    __LabelID: never;
};
/**
 * The `ListTypeDefID` scalar type represents an identifier for an object of type ListTypeDef.
 */
type ListTypeDefID = string & {
    __ListTypeDefID: never;
};
type ModuleServeOpts = {
    /**
     * Expose the dependencies of this module to the client
     */
    includeDependencies?: boolean;
};
/**
 * The `ModuleConfigClientID` scalar type represents an identifier for an object of type ModuleConfigClient.
 */
type ModuleConfigClientID = string & {
    __ModuleConfigClientID: never;
};
/**
 * The `ModuleID` scalar type represents an identifier for an object of type Module.
 */
type ModuleID = string & {
    __ModuleID: never;
};
/**
 * The `ModuleSourceID` scalar type represents an identifier for an object of type ModuleSource.
 */
type ModuleSourceID = string & {
    __ModuleSourceID: never;
};
/**
 * The kind of module source.
 */
declare enum ModuleSourceKind {
    Dir = "DIR",
    DirSource = "DIR_SOURCE",
    Git = "GIT",
    GitSource = "GIT_SOURCE",
    Local = "LOCAL",
    LocalSource = "LOCAL_SOURCE"
}
/**
 * Transport layer network protocol associated to a port.
 */
declare enum NetworkProtocol {
    Tcp = "TCP",
    Udp = "UDP"
}
/**
 * The `ObjectTypeDefID` scalar type represents an identifier for an object of type ObjectTypeDef.
 */
type ObjectTypeDefID = string & {
    __ObjectTypeDefID: never;
};
type PipelineLabel = {
    /**
     * Label name.
     */
    name: string;
    /**
     * Label value.
     */
    value: string;
};
/**
 * The platform config OS and architecture in a Container.
 *
 * The format is [os]/[platform]/[version] (e.g., "darwin/arm64/v7", "windows/amd64", "linux/arm64").
 */
type Platform = string & {
    __Platform: never;
};
type PortForward = {
    /**
     * Destination port for traffic.
     */
    backend: number;
    /**
     * Port to expose to clients. If unspecified, a default will be chosen.
     */
    frontend?: number;
    /**
     * Transport layer protocol to use for traffic.
     */
    protocol?: NetworkProtocol;
};
/**
 * The `PortID` scalar type represents an identifier for an object of type Port.
 */
type PortID = string & {
    __PortID: never;
};
type ClientContainerOpts = {
    /**
     * Platform to initialize the container with. Defaults to the native platform of the current engine
     */
    platform?: Platform;
};
type ClientEnvOpts = {
    /**
     * Give the environment the same privileges as the caller: core API including host access, current module, and dependencies
     */
    privileged?: boolean;
    /**
     * Allow new outputs to be declared and saved in the environment
     */
    writable?: boolean;
};
type ClientFileOpts = {
    /**
     * Permissions of the new file. Example: 0600
     */
    permissions?: number;
};
type ClientGitOpts = {
    /**
     * DEPRECATED: Set to true to keep .git directory.
     */
    keepGitDir?: boolean;
    /**
     * Set SSH known hosts
     */
    sshKnownHosts?: string;
    /**
     * Set SSH auth socket
     */
    sshAuthSocket?: Socket;
    /**
     * Username used to populate the password during basic HTTP Authorization
     */
    httpAuthUsername?: string;
    /**
     * Secret used to populate the password during basic HTTP Authorization
     */
    httpAuthToken?: Secret;
    /**
     * Secret used to populate the Authorization HTTP header
     */
    httpAuthHeader?: Secret;
    /**
     * A service which must be started before the repo is fetched.
     */
    experimentalServiceHost?: Service;
};
type ClientHttpOpts = {
    /**
     * File name to use for the file. Defaults to the last part of the URL.
     */
    name?: string;
    /**
     * Permissions to set on the file.
     */
    permissions?: number;
    /**
     * Secret used to populate the Authorization HTTP header
     */
    authHeader?: Secret;
    /**
     * A service which must be started before the URL is fetched.
     */
    experimentalServiceHost?: Service;
};
type ClientLlmOpts = {
    /**
     * Model to use
     */
    model?: string;
    /**
     * Cap the number of API calls for this LLM
     */
    maxAPICalls?: number;
};
type ClientModuleSourceOpts = {
    /**
     * The pinned version of the module source
     */
    refPin?: string;
    /**
     * If true, do not attempt to find dagger.json in a parent directory of the provided path. Only relevant for local module sources.
     */
    disableFindUp?: boolean;
    /**
     * If true, do not error out if the provided ref string is a local path and does not exist yet. Useful when initializing new modules in directories that don't exist yet.
     */
    allowNotExists?: boolean;
    /**
     * If set, error out if the ref string is not of the provided requireKind.
     */
    requireKind?: ModuleSourceKind;
};
type ClientSecretOpts = {
    /**
     * If set, the given string will be used as the cache key for this secret. This means that any secrets with the same cache key will be considered equivalent in terms of cache lookups, even if they have different URIs or plaintext values.
     *
     * For example, two secrets with the same cache key provided as secret env vars to other wise equivalent containers will result in the container withExecs hitting the cache for each other.
     *
     * If not set, the cache key for the secret will be derived from its plaintext value as looked up when the secret is constructed.
     */
    cacheKey?: string;
};
/**
 * Expected return type of an execution
 */
declare enum ReturnType {
    /**
     * Any execution (exit codes 0-127)
     */
    Any = "ANY",
    /**
     * A failed execution (exit codes 1-127)
     */
    Failure = "FAILURE",
    /**
     * A successful execution (exit code 0)
     */
    Success = "SUCCESS"
}
/**
 * The `SDKConfigID` scalar type represents an identifier for an object of type SDKConfig.
 */
type SDKConfigID = string & {
    __SDKConfigID: never;
};
/**
 * The `ScalarTypeDefID` scalar type represents an identifier for an object of type ScalarTypeDef.
 */
type ScalarTypeDefID = string & {
    __ScalarTypeDefID: never;
};
/**
 * The `SecretID` scalar type represents an identifier for an object of type Secret.
 */
type SecretID = string & {
    __SecretID: never;
};
type ServiceEndpointOpts = {
    /**
     * The exposed port number for the endpoint
     */
    port?: number;
    /**
     * Return a URL with the given scheme, eg. http for http://
     */
    scheme?: string;
};
type ServiceStopOpts = {
    /**
     * Immediately kill the service without waiting for a graceful exit
     */
    kill?: boolean;
};
type ServiceUpOpts = {
    /**
     * List of frontend/backend port mappings to forward.
     *
     * Frontend is the port accepting traffic on the host, backend is the service port.
     */
    ports?: PortForward[];
    /**
     * Bind each tunnel port to a random port on the host.
     */
    random?: boolean;
};
/**
 * The `ServiceID` scalar type represents an identifier for an object of type Service.
 */
type ServiceID = string & {
    __ServiceID: never;
};
/**
 * The `SocketID` scalar type represents an identifier for an object of type Socket.
 */
type SocketID = string & {
    __SocketID: never;
};
/**
 * The `SourceMapID` scalar type represents an identifier for an object of type SourceMap.
 */
type SourceMapID = string & {
    __SourceMapID: never;
};
/**
 * The `TerminalID` scalar type represents an identifier for an object of type Terminal.
 */
type TerminalID = string & {
    __TerminalID: never;
};
type TypeDefWithEnumOpts = {
    /**
     * A doc string for the enum, if any
     */
    description?: string;
    /**
     * The source map for the enum definition.
     */
    sourceMap?: SourceMap;
};
type TypeDefWithEnumMemberOpts = {
    /**
     * The value of the member in the enum
     */
    value?: string;
    /**
     * A doc string for the member, if any
     */
    description?: string;
    /**
     * The source map for the enum member definition.
     */
    sourceMap?: SourceMap;
};
type TypeDefWithEnumValueOpts = {
    /**
     * A doc string for the value, if any
     */
    description?: string;
    /**
     * The source map for the enum value definition.
     */
    sourceMap?: SourceMap;
};
type TypeDefWithFieldOpts = {
    /**
     * A doc string for the field, if any
     */
    description?: string;
    /**
     * The source map for the field definition.
     */
    sourceMap?: SourceMap;
};
type TypeDefWithInterfaceOpts = {
    description?: string;
    sourceMap?: SourceMap;
};
type TypeDefWithObjectOpts = {
    description?: string;
    sourceMap?: SourceMap;
};
type TypeDefWithScalarOpts = {
    description?: string;
};
/**
 * The `TypeDefID` scalar type represents an identifier for an object of type TypeDef.
 */
type TypeDefID = string & {
    __TypeDefID: never;
};
/**
 * Distinguishes the different kinds of TypeDefs.
 */
declare enum TypeDefKind {
    /**
     * A boolean value.
     */
    Boolean = "BOOLEAN",
    /**
     * A boolean value.
     */
    BooleanKind = "BOOLEAN_KIND",
    /**
     * A GraphQL enum type and its values
     *
     * Always paired with an EnumTypeDef.
     */
    Enum = "ENUM",
    /**
     * A GraphQL enum type and its values
     *
     * Always paired with an EnumTypeDef.
     */
    EnumKind = "ENUM_KIND",
    /**
     * A float value.
     */
    Float = "FLOAT",
    /**
     * A float value.
     */
    FloatKind = "FLOAT_KIND",
    /**
     * A graphql input type, used only when representing the core API via TypeDefs.
     */
    Input = "INPUT",
    /**
     * A graphql input type, used only when representing the core API via TypeDefs.
     */
    InputKind = "INPUT_KIND",
    /**
     * An integer value.
     */
    Integer = "INTEGER",
    /**
     * An integer value.
     */
    IntegerKind = "INTEGER_KIND",
    /**
     * Always paired with an InterfaceTypeDef.
     *
     * A named type of functions that can be matched+implemented by other objects+interfaces.
     */
    Interface = "INTERFACE",
    /**
     * Always paired with an InterfaceTypeDef.
     *
     * A named type of functions that can be matched+implemented by other objects+interfaces.
     */
    InterfaceKind = "INTERFACE_KIND",
    /**
     * Always paired with a ListTypeDef.
     *
     * A list of values all having the same type.
     */
    List = "LIST",
    /**
     * Always paired with a ListTypeDef.
     *
     * A list of values all having the same type.
     */
    ListKind = "LIST_KIND",
    /**
     * Always paired with an ObjectTypeDef.
     *
     * A named type defined in the GraphQL schema, with fields and functions.
     */
    Object = "OBJECT",
    /**
     * Always paired with an ObjectTypeDef.
     *
     * A named type defined in the GraphQL schema, with fields and functions.
     */
    ObjectKind = "OBJECT_KIND",
    /**
     * A scalar value of any basic kind.
     */
    Scalar = "SCALAR",
    /**
     * A scalar value of any basic kind.
     */
    ScalarKind = "SCALAR_KIND",
    /**
     * A string value.
     */
    String = "STRING",
    /**
     * A string value.
     */
    StringKind = "STRING_KIND",
    /**
     * A special kind used to signify that no value is returned.
     *
     * This is used for functions that have no return value. The outer TypeDef specifying this Kind is always Optional, as the Void is never actually represented.
     */
    Void = "VOID",
    /**
     * A special kind used to signify that no value is returned.
     *
     * This is used for functions that have no return value. The outer TypeDef specifying this Kind is always Optional, as the Void is never actually represented.
     */
    VoidKind = "VOID_KIND"
}
/**
 * The absence of a value.
 *
 * A Null Void is used as a placeholder for resolvers that do not return anything.
 */
type Void = string & {
    __Void: never;
};
type __TypeEnumValuesOpts = {
    includeDeprecated?: boolean;
};
type __TypeFieldsOpts = {
    includeDeprecated?: boolean;
};
declare class Binding extends BaseClient {
    private readonly _id?;
    private readonly _asString?;
    private readonly _digest?;
    private readonly _isNull?;
    private readonly _name?;
    private readonly _typeName?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: BindingID, _asString?: string, _digest?: string, _isNull?: boolean, _name?: string, _typeName?: string);
    /**
     * A unique identifier for this Binding.
     */
    id: () => Promise<BindingID>;
    /**
     * Retrieve the binding value, as type CacheVolume
     */
    asCacheVolume: () => CacheVolume;
    /**
     * Retrieve the binding value, as type Cloud
     */
    asCloud: () => Cloud;
    /**
     * Retrieve the binding value, as type Container
     */
    asContainer: () => Container;
    /**
     * Retrieve the binding value, as type Directory
     */
    asDirectory: () => Directory;
    /**
     * Retrieve the binding value, as type Env
     */
    asEnv: () => Env;
    /**
     * Retrieve the binding value, as type File
     */
    asFile: () => File;
    /**
     * Retrieve the binding value, as type GitRef
     */
    asGitRef: () => GitRef;
    /**
     * Retrieve the binding value, as type GitRepository
     */
    asGitRepository: () => GitRepository;
    /**
     * Retrieve the binding value, as type LLM
     */
    asLLM: () => LLM;
    /**
     * Retrieve the binding value, as type Module
     */
    asModule: () => Module_;
    /**
     * Retrieve the binding value, as type ModuleConfigClient
     */
    asModuleConfigClient: () => ModuleConfigClient;
    /**
     * Retrieve the binding value, as type ModuleSource
     */
    asModuleSource: () => ModuleSource;
    /**
     * Retrieve the binding value, as type Secret
     */
    asSecret: () => Secret;
    /**
     * Retrieve the binding value, as type Service
     */
    asService: () => Service;
    /**
     * Retrieve the binding value, as type Socket
     */
    asSocket: () => Socket;
    /**
     * The binding's string value
     */
    asString: () => Promise<string>;
    /**
     * The digest of the binding value
     */
    digest: () => Promise<string>;
    /**
     * Returns true if the binding is null
     */
    isNull: () => Promise<boolean>;
    /**
     * The binding name
     */
    name: () => Promise<string>;
    /**
     * The binding type
     */
    typeName: () => Promise<string>;
}
/**
 * A directory whose contents persist across runs.
 */
declare class CacheVolume extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: CacheVolumeID);
    /**
     * A unique identifier for this CacheVolume.
     */
    id: () => Promise<CacheVolumeID>;
}
/**
 * Dagger Cloud configuration and state
 */
declare class Cloud extends BaseClient {
    private readonly _id?;
    private readonly _traceURL?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: CloudID, _traceURL?: string);
    /**
     * A unique identifier for this Cloud.
     */
    id: () => Promise<CloudID>;
    /**
     * The trace URL for the current session
     */
    traceURL: () => Promise<string>;
}
/**
 * An OCI-compatible container, also known as a Docker container.
 */
declare class Container extends BaseClient {
    private readonly _id?;
    private readonly _envVariable?;
    private readonly _exitCode?;
    private readonly _export?;
    private readonly _imageRef?;
    private readonly _label?;
    private readonly _platform?;
    private readonly _publish?;
    private readonly _stderr?;
    private readonly _stdout?;
    private readonly _sync?;
    private readonly _up?;
    private readonly _user?;
    private readonly _workdir?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ContainerID, _envVariable?: string, _exitCode?: number, _export?: string, _imageRef?: string, _label?: string, _platform?: Platform, _publish?: string, _stderr?: string, _stdout?: string, _sync?: ContainerID, _up?: Void, _user?: string, _workdir?: string);
    /**
     * A unique identifier for this Container.
     */
    id: () => Promise<ContainerID>;
    /**
     * Turn the container into a Service.
     *
     * Be sure to set any exposed ports before this conversion.
     * @param opts.args Command to run instead of the container's default command (e.g., ["go", "run", "main.go"]).
     *
     * If empty, the container's default command is used.
     * @param opts.useEntrypoint If the container has an entrypoint, prepend it to the args.
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     * @param opts.noInit If set, skip the automatic init process injected into containers by default.
     *
     * This should only be used if the user requires that their exec process be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    asService: (opts?: ContainerAsServiceOpts) => Service;
    /**
     * Package the container state as an OCI image, and return it as a tar archive
     * @param opts.platformVariants Identifiers for other platform specific containers.
     *
     * Used for multi-platform images.
     * @param opts.forcedCompression Force each layer of the image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     * @param opts.mediaTypes Use the specified media types for the image's layers.
     *
     * Defaults to OCI, which is largely compatible with most recent container runtimes, but Docker may be needed for older runtimes without OCI support.
     */
    asTarball: (opts?: ContainerAsTarballOpts) => File;
    /**
     * Initializes this container from a Dockerfile build.
     * @param context Directory context used by the Dockerfile.
     * @param opts.dockerfile Path to the Dockerfile to use.
     * @param opts.target Target build stage to build.
     * @param opts.buildArgs Additional build arguments.
     * @param opts.secrets Secrets to pass to the build.
     *
     * They will be mounted at /run/secrets/[secret-name] in the build container
     *
     * They can be accessed in the Dockerfile using the "secret" mount type and mount path /run/secrets/[secret-name], e.g. RUN --mount=type=secret,id=my-secret curl [http://example.com?token=$(cat /run/secrets/my-secret)](http://example.com?token=$(cat /run/secrets/my-secret))
     * @param opts.noInit If set, skip the automatic init process injected into containers created by RUN statements.
     *
     * This should only be used if the user requires that their exec processes be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    build: (context: Directory, opts?: ContainerBuildOpts) => Container;
    /**
     * Return the container's default arguments.
     */
    defaultArgs: () => Promise<string[]>;
    /**
     * Retrieve a directory from the container's root filesystem
     *
     * Mounts are included.
     * @param path The path of the directory to retrieve (e.g., "./src").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    directory: (path: string, opts?: ContainerDirectoryOpts) => Directory;
    /**
     * Return the container's OCI entrypoint.
     */
    entrypoint: () => Promise<string[]>;
    /**
     * Retrieves the value of the specified environment variable.
     * @param name The name of the environment variable to retrieve (e.g., "PATH").
     */
    envVariable: (name: string) => Promise<string>;
    /**
     * Retrieves the list of environment variables passed to commands.
     */
    envVariables: () => Promise<EnvVariable[]>;
    /**
     * The exit code of the last executed command
     *
     * Returns an error if no command was executed
     */
    exitCode: () => Promise<number>;
    /**
     * EXPERIMENTAL API! Subject to change/removal at any time.
     *
     * Configures all available GPUs on the host to be accessible to this container.
     *
     * This currently works for Nvidia devices only.
     */
    experimentalWithAllGPUs: () => Container;
    /**
     * EXPERIMENTAL API! Subject to change/removal at any time.
     *
     * Configures the provided list of devices to be accessible to this container.
     *
     * This currently works for Nvidia devices only.
     * @param devices List of devices to be accessible to this container.
     */
    experimentalWithGPU: (devices: string[]) => Container;
    /**
     * Writes the container as an OCI tarball to the destination file path on the host.
     *
     * It can also export platform variants.
     * @param path Host's destination path (e.g., "./tarball").
     *
     * Path can be relative to the engine's workdir or absolute.
     * @param opts.platformVariants Identifiers for other platform specific containers.
     *
     * Used for multi-platform image.
     * @param opts.forcedCompression Force each layer of the exported image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     * @param opts.mediaTypes Use the specified media types for the exported image's layers.
     *
     * Defaults to OCI, which is largely compatible with most recent container runtimes, but Docker may be needed for older runtimes without OCI support.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    export: (path: string, opts?: ContainerExportOpts) => Promise<string>;
    /**
     * Retrieves the list of exposed ports.
     *
     * This includes ports already exposed by the image, even if not explicitly added with dagger.
     */
    exposedPorts: () => Promise<Port[]>;
    /**
     * Retrieves a file at the given path.
     *
     * Mounts are included.
     * @param path The path of the file to retrieve (e.g., "./README.md").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    file: (path: string, opts?: ContainerFileOpts) => File;
    /**
     * Download a container image, and apply it to the container state. All previous state will be lost.
     * @param address Address of the container image to download, in standard OCI ref format. Example:"registry.dagger.io/engine:latest"
     */
    from: (address: string) => Container;
    /**
     * The unique image reference which can only be retrieved immediately after the 'Container.From' call.
     */
    imageRef: () => Promise<string>;
    /**
     * Reads the container from an OCI tarball.
     * @param source File to read the container from.
     * @param opts.tag Identifies the tag to import from the archive, if the archive bundles multiple tags.
     */
    import_: (source: File, opts?: ContainerImportOpts) => Container;
    /**
     * Retrieves the value of the specified label.
     * @param name The name of the label (e.g., "org.opencontainers.artifact.created").
     */
    label: (name: string) => Promise<string>;
    /**
     * Retrieves the list of labels passed to container.
     */
    labels: () => Promise<Label[]>;
    /**
     * Retrieves the list of paths where a directory is mounted.
     */
    mounts: () => Promise<string[]>;
    /**
     * The platform this container executes and publishes as.
     */
    platform: () => Promise<Platform>;
    /**
     * Package the container state as an OCI image, and publish it to a registry
     *
     * Returns the fully qualified address of the published image, with digest
     * @param address The OCI address to publish to
     *
     * Same format as "docker push". Example: "registry.example.com/user/repo:tag"
     * @param opts.platformVariants Identifiers for other platform specific containers.
     *
     * Used for multi-platform image.
     * @param opts.forcedCompression Force each layer of the published image to use the specified compression algorithm.
     *
     * If this is unset, then if a layer already has a compressed blob in the engine's cache, that will be used (this can result in a mix of compression algorithms for different layers). If this is unset and a layer has no compressed blob in the engine's cache, then it will be compressed using Gzip.
     * @param opts.mediaTypes Use the specified media types for the published image's layers.
     *
     * Defaults to "OCI", which is compatible with most recent registries, but "Docker" may be needed for older registries without OCI support.
     */
    publish: (address: string, opts?: ContainerPublishOpts) => Promise<string>;
    /**
     * Return a snapshot of the container's root filesystem. The snapshot can be modified then written back using withRootfs. Use that method for filesystem modifications.
     */
    rootfs: () => Directory;
    /**
     * The buffered standard error stream of the last executed command
     *
     * Returns an error if no command was executed
     */
    stderr: () => Promise<string>;
    /**
     * The buffered standard output stream of the last executed command
     *
     * Returns an error if no command was executed
     */
    stdout: () => Promise<string>;
    /**
     * Forces evaluation of the pipeline in the engine.
     *
     * It doesn't run the default command if no exec has been set.
     */
    sync: () => Promise<Container>;
    /**
     * Opens an interactive terminal for this container using its configured default terminal command if not overridden by args (or sh as a fallback default).
     * @param opts.cmd If set, override the container's default terminal command and invoke these command arguments instead.
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    terminal: (opts?: ContainerTerminalOpts) => Container;
    /**
     * Starts a Service and creates a tunnel that forwards traffic from the caller's network to that service.
     *
     * Be sure to set any exposed ports before calling this api.
     * @param opts.random Bind each tunnel port to a random port on the host.
     * @param opts.ports List of frontend/backend port mappings to forward.
     *
     * Frontend is the port accepting traffic on the host, backend is the service port.
     * @param opts.args Command to run instead of the container's default command (e.g., ["go", "run", "main.go"]).
     *
     * If empty, the container's default command is used.
     * @param opts.useEntrypoint If the container has an entrypoint, prepend it to the args.
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     * @param opts.noInit If set, skip the automatic init process injected into containers by default.
     *
     * This should only be used if the user requires that their exec process be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    up: (opts?: ContainerUpOpts) => Promise<void>;
    /**
     * Retrieves the user to be set for all commands.
     */
    user: () => Promise<string>;
    /**
     * Retrieves this container plus the given OCI anotation.
     * @param name The name of the annotation.
     * @param value The value of the annotation.
     */
    withAnnotation: (name: string, value: string) => Container;
    /**
     * Configures default arguments for future commands. Like CMD in Dockerfile.
     * @param args Arguments to prepend to future executions (e.g., ["-v", "--no-cache"]).
     */
    withDefaultArgs: (args: string[]) => Container;
    /**
     * Set the default command to invoke for the container's terminal API.
     * @param args The args of the command.
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    withDefaultTerminalCmd: (args: string[], opts?: ContainerWithDefaultTerminalCmdOpts) => Container;
    /**
     * Return a new container snapshot, with a directory added to its filesystem
     * @param path Location of the written directory (e.g., "/tmp/directory").
     * @param directory Identifier of the directory to write
     * @param opts.exclude Patterns to exclude in the written directory (e.g. ["node_modules/**", ".gitignore", ".git/"]).
     * @param opts.include Patterns to include in the written directory (e.g. ["*.go", "go.mod", "go.sum"]).
     * @param opts.owner A user:group to set for the directory and its contents.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withDirectory: (path: string, directory: Directory, opts?: ContainerWithDirectoryOpts) => Container;
    /**
     * Set an OCI-style entrypoint. It will be included in the container's OCI configuration. Note, withExec ignores the entrypoint by default.
     * @param args Arguments of the entrypoint. Example: ["go", "run"].
     * @param opts.keepDefaultArgs Don't reset the default arguments when setting the entrypoint. By default it is reset, since entrypoint and default args are often tightly coupled.
     */
    withEntrypoint: (args: string[], opts?: ContainerWithEntrypointOpts) => Container;
    /**
     * Set a new environment variable in the container.
     * @param name Name of the environment variable (e.g., "HOST").
     * @param value Value of the environment variable. (e.g., "localhost").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value according to the current environment variables defined in the container (e.g. "/opt/bin:$PATH").
     */
    withEnvVariable: (name: string, value: string, opts?: ContainerWithEnvVariableOpts) => Container;
    /**
     * Execute a command in the container, and return a new snapshot of the container state after execution.
     * @param args Command to execute. Must be valid exec() arguments, not a shell command. Example: ["go", "run", "main.go"].
     *
     * To run a shell command, execute the shell and pass the shell command as argument. Example: ["sh", "-c", "ls -l | grep foo"]
     *
     * Defaults to the container's default arguments (see "defaultArgs" and "withDefaultArgs").
     * @param opts.useEntrypoint Apply the OCI entrypoint, if present, by prepending it to the args. Ignored by default.
     * @param opts.stdin Content to write to the command's standard input. Example: "Hello world")
     * @param opts.redirectStdout Redirect the command's standard output to a file in the container. Example: "./stdout.txt"
     * @param opts.redirectStderr Like redirectStdout, but for standard error
     * @param opts.expect Exit codes this command is allowed to exit with without error
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. Like --privileged in Docker
     *
     * DANGER: this grants the command full access to the host system. Only use when 1) you trust the command being executed and 2) you specifically need this level of access.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the args according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     * @param opts.noInit Skip the automatic init process injected into containers by default.
     *
     * Only use this if you specifically need the command to be pid 1 in the container. Otherwise it may result in unexpected behavior. If you're not sure, you don't need this.
     */
    withExec: (args: string[], opts?: ContainerWithExecOpts) => Container;
    /**
     * Expose a network port. Like EXPOSE in Dockerfile (but with healthcheck support)
     *
     * Exposed ports serve two purposes:
     *
     * - For health checks and introspection, when running services
     *
     * - For setting the EXPOSE OCI field when publishing the container
     * @param port Port number to expose. Example: 8080
     * @param opts.protocol Network protocol. Example: "tcp"
     * @param opts.description Port description. Example: "payment API endpoint"
     * @param opts.experimentalSkipHealthcheck Skip the health check when run as a service.
     */
    withExposedPort: (port: number, opts?: ContainerWithExposedPortOpts) => Container;
    /**
     * Return a container snapshot with a file added
     * @param path Path of the new file. Example: "/path/to/new-file.txt"
     * @param source File to add
     * @param opts.permissions Permissions of the new file. Example: 0600
     * @param opts.owner A user:group to set for the file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withFile: (path: string, source: File, opts?: ContainerWithFileOpts) => Container;
    /**
     * Retrieves this container plus the contents of the given files copied to the given path.
     * @param path Location where copied files should be placed (e.g., "/src").
     * @param sources Identifiers of the files to copy.
     * @param opts.permissions Permission given to the copied files (e.g., 0600).
     * @param opts.owner A user:group to set for the files.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withFiles: (path: string, sources: File[], opts?: ContainerWithFilesOpts) => Container;
    /**
     * Retrieves this container plus the given label.
     * @param name The name of the label (e.g., "org.opencontainers.artifact.created").
     * @param value The value of the label (e.g., "2023-01-01T00:00:00Z").
     */
    withLabel: (name: string, value: string) => Container;
    /**
     * Retrieves this container plus a cache volume mounted at the given path.
     * @param path Location of the cache directory (e.g., "/root/.npm").
     * @param cache Identifier of the cache volume to mount.
     * @param opts.source Identifier of the directory to use as the cache volume's root.
     * @param opts.sharing Sharing mode of the cache volume.
     * @param opts.owner A user:group to set for the mounted cache directory.
     *
     * Note that this changes the ownership of the specified mount along with the initial filesystem provided by source (if any). It does not have any effect if/when the cache has already been created.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withMountedCache: (path: string, cache: CacheVolume, opts?: ContainerWithMountedCacheOpts) => Container;
    /**
     * Retrieves this container plus a directory mounted at the given path.
     * @param path Location of the mounted directory (e.g., "/mnt/directory").
     * @param source Identifier of the mounted directory.
     * @param opts.owner A user:group to set for the mounted directory and its contents.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withMountedDirectory: (path: string, source: Directory, opts?: ContainerWithMountedDirectoryOpts) => Container;
    /**
     * Retrieves this container plus a file mounted at the given path.
     * @param path Location of the mounted file (e.g., "/tmp/file.txt").
     * @param source Identifier of the mounted file.
     * @param opts.owner A user or user:group to set for the mounted file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withMountedFile: (path: string, source: File, opts?: ContainerWithMountedFileOpts) => Container;
    /**
     * Retrieves this container plus a secret mounted into a file at the given path.
     * @param path Location of the secret file (e.g., "/tmp/secret.txt").
     * @param source Identifier of the secret to mount.
     * @param opts.owner A user:group to set for the mounted secret.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.mode Permission given to the mounted secret (e.g., 0600).
     *
     * This option requires an owner to be set to be active.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withMountedSecret: (path: string, source: Secret, opts?: ContainerWithMountedSecretOpts) => Container;
    /**
     * Retrieves this container plus a temporary directory mounted at the given path. Any writes will be ephemeral to a single withExec call; they will not be persisted to subsequent withExecs.
     * @param path Location of the temporary directory (e.g., "/tmp/temp_dir").
     * @param opts.size Size of the temporary directory in bytes.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withMountedTemp: (path: string, opts?: ContainerWithMountedTempOpts) => Container;
    /**
     * Return a new container snapshot, with a file added to its filesystem with text content
     * @param path Path of the new file. May be relative or absolute. Example: "README.md" or "/etc/profile"
     * @param contents Contents of the new file. Example: "Hello world!"
     * @param opts.permissions Permissions of the new file. Example: 0600
     * @param opts.owner A user:group to set for the file.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withNewFile: (path: string, contents: string, opts?: ContainerWithNewFileOpts) => Container;
    /**
     * Attach credentials for future publishing to a registry. Use in combination with publish
     * @param address The image address that needs authentication. Same format as "docker push". Example: "registry.dagger.io/dagger:latest"
     * @param username The username to authenticate with. Example: "alice"
     * @param secret The API key, password or token to authenticate to this registry
     */
    withRegistryAuth: (address: string, username: string, secret: Secret) => Container;
    /**
     * Change the container's root filesystem. The previous root filesystem will be lost.
     * @param directory The new root filesystem.
     */
    withRootfs: (directory: Directory) => Container;
    /**
     * Set a new environment variable, using a secret value
     * @param name Name of the secret variable (e.g., "API_SECRET").
     * @param secret Identifier of the secret value.
     */
    withSecretVariable: (name: string, secret: Secret) => Container;
    /**
     * Establish a runtime dependency from a container to a network service.
     *
     * The service will be started automatically when needed and detached when it is no longer needed, executing the default command if none is set.
     *
     * The service will be reachable from the container via the provided hostname alias.
     *
     * The service dependency will also convey to any files or directories produced by the container.
     * @param alias Hostname that will resolve to the target service (only accessible from within this container)
     * @param service The target service
     */
    withServiceBinding: (alias: string, service: Service) => Container;
    /**
     * Return a snapshot with a symlink
     * @param target Location of the file or directory to link to (e.g., "/existing/file").
     * @param linkName Location where the symbolic link will be created (e.g., "/new-file-link").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withSymlink: (target: string, linkName: string, opts?: ContainerWithSymlinkOpts) => Container;
    /**
     * Retrieves this container plus a socket forwarded to the given Unix socket path.
     * @param path Location of the forwarded Unix socket (e.g., "/tmp/socket").
     * @param source Identifier of the socket to forward.
     * @param opts.owner A user:group to set for the mounted socket.
     *
     * The user and group can either be an ID (1000:1000) or a name (foo:bar).
     *
     * If the group is omitted, it defaults to the same as the user.
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withUnixSocket: (path: string, source: Socket, opts?: ContainerWithUnixSocketOpts) => Container;
    /**
     * Retrieves this container with a different command user.
     * @param name The user to set (e.g., "root").
     */
    withUser: (name: string) => Container;
    /**
     * Change the container's working directory. Like WORKDIR in Dockerfile.
     * @param path The path to set as the working directory (e.g., "/app").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withWorkdir: (path: string, opts?: ContainerWithWorkdirOpts) => Container;
    /**
     * Retrieves this container minus the given OCI annotation.
     * @param name The name of the annotation.
     */
    withoutAnnotation: (name: string) => Container;
    /**
     * Remove the container's default arguments.
     */
    withoutDefaultArgs: () => Container;
    /**
     * Return a new container snapshot, with a directory removed from its filesystem
     * @param path Location of the directory to remove (e.g., ".github/").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withoutDirectory: (path: string, opts?: ContainerWithoutDirectoryOpts) => Container;
    /**
     * Reset the container's OCI entrypoint.
     * @param opts.keepDefaultArgs Don't remove the default arguments when unsetting the entrypoint.
     */
    withoutEntrypoint: (opts?: ContainerWithoutEntrypointOpts) => Container;
    /**
     * Retrieves this container minus the given environment variable.
     * @param name The name of the environment variable (e.g., "HOST").
     */
    withoutEnvVariable: (name: string) => Container;
    /**
     * Unexpose a previously exposed port.
     * @param port Port number to unexpose
     * @param opts.protocol Port protocol to unexpose
     */
    withoutExposedPort: (port: number, opts?: ContainerWithoutExposedPortOpts) => Container;
    /**
     * Retrieves this container with the file at the given path removed.
     * @param path Location of the file to remove (e.g., "/file.txt").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withoutFile: (path: string, opts?: ContainerWithoutFileOpts) => Container;
    /**
     * Return a new container spanshot with specified files removed
     * @param paths Paths of the files to remove. Example: ["foo.txt, "/root/.ssh/config"
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of paths according to the current environment variables defined in the container (e.g. "/$VAR/foo.txt").
     */
    withoutFiles: (paths: string[], opts?: ContainerWithoutFilesOpts) => Container;
    /**
     * Retrieves this container minus the given environment label.
     * @param name The name of the label to remove (e.g., "org.opencontainers.artifact.created").
     */
    withoutLabel: (name: string) => Container;
    /**
     * Retrieves this container after unmounting everything at the given path.
     * @param path Location of the cache directory (e.g., "/root/.npm").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withoutMount: (path: string, opts?: ContainerWithoutMountOpts) => Container;
    /**
     * Retrieves this container without the registry authentication of a given address.
     * @param address Registry's address to remove the authentication from.
     *
     * Formatted as [host]/[user]/[repo]:[tag] (e.g. docker.io/dagger/dagger:main).
     */
    withoutRegistryAuth: (address: string) => Container;
    /**
     * Retrieves this container minus the given environment variable containing the secret.
     * @param name The name of the environment variable (e.g., "HOST").
     */
    withoutSecretVariable: (name: string) => Container;
    /**
     * Retrieves this container with a previously added Unix socket removed.
     * @param path Location of the socket to remove (e.g., "/tmp/socket").
     * @param opts.expand Replace "${VAR}" or "$VAR" in the value of path according to the current environment variables defined in the container (e.g. "/$VAR/foo").
     */
    withoutUnixSocket: (path: string, opts?: ContainerWithoutUnixSocketOpts) => Container;
    /**
     * Retrieves this container with an unset command user.
     *
     * Should default to root.
     */
    withoutUser: () => Container;
    /**
     * Unset the container's working directory.
     *
     * Should default to "/".
     */
    withoutWorkdir: () => Container;
    /**
     * Retrieves the working directory for all commands.
     */
    workdir: () => Promise<string>;
    /**
     * Call the provided function with current Container.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Container) => Container) => Container;
}
/**
 * Reflective module API provided to functions at runtime.
 */
declare class CurrentModule extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: CurrentModuleID, _name?: string);
    /**
     * A unique identifier for this CurrentModule.
     */
    id: () => Promise<CurrentModuleID>;
    /**
     * The name of the module being executed in
     */
    name: () => Promise<string>;
    /**
     * The directory containing the module's source code loaded into the engine (plus any generated code that may have been created).
     */
    source: () => Directory;
    /**
     * Load a directory from the module's scratch working directory, including any changes that may have been made to it during module function execution.
     * @param path Location of the directory to access (e.g., ".").
     * @param opts.exclude Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     * @param opts.include Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     */
    workdir: (path: string, opts?: CurrentModuleWorkdirOpts) => Directory;
    /**
     * Load a file from the module's scratch working directory, including any changes that may have been made to it during module function execution.Load a file from the module's scratch working directory, including any changes that may have been made to it during module function execution.
     * @param path Location of the file to retrieve (e.g., "README.md").
     */
    workdirFile: (path: string) => File;
}
/**
 * A directory.
 */
declare class Directory extends BaseClient {
    private readonly _id?;
    private readonly _digest?;
    private readonly _export?;
    private readonly _name?;
    private readonly _sync?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: DirectoryID, _digest?: string, _export?: string, _name?: string, _sync?: DirectoryID);
    /**
     * A unique identifier for this Directory.
     */
    id: () => Promise<DirectoryID>;
    /**
     * Converts this directory to a local git repository
     */
    asGit: () => GitRepository;
    /**
     * Load the directory as a Dagger module source
     * @param opts.sourceRootPath An optional subpath of the directory which contains the module's configuration file.
     *
     * If not set, the module source code is loaded from the root of the directory.
     */
    asModule: (opts?: DirectoryAsModuleOpts) => Module_;
    /**
     * Load the directory as a Dagger module source
     * @param opts.sourceRootPath An optional subpath of the directory which contains the module's configuration file.
     *
     * If not set, the module source code is loaded from the root of the directory.
     */
    asModuleSource: (opts?: DirectoryAsModuleSourceOpts) => ModuleSource;
    /**
     * Return the difference between this directory and an another directory. The difference is encoded as a directory.
     * @param other The directory to compare against
     */
    diff: (other: Directory) => Directory;
    /**
     * Return the directory's digest. The format of the digest is not guaranteed to be stable between releases of Dagger. It is guaranteed to be stable between invocations of the same Dagger engine.
     */
    digest: () => Promise<string>;
    /**
     * Retrieves a directory at the given path.
     * @param path Location of the directory to retrieve. Example: "/src"
     */
    directory: (path: string) => Directory;
    /**
     * Use Dockerfile compatibility to build a container from this directory. Only use this function for Dockerfile compatibility. Otherwise use the native Container type directly, it is feature-complete and supports all Dockerfile features.
     * @param opts.dockerfile Path to the Dockerfile to use (e.g., "frontend.Dockerfile").
     * @param opts.platform The platform to build.
     * @param opts.buildArgs Build arguments to use in the build.
     * @param opts.target Target build stage to build.
     * @param opts.secrets Secrets to pass to the build.
     *
     * They will be mounted at /run/secrets/[secret-name].
     * @param opts.noInit If set, skip the automatic init process injected into containers created by RUN statements.
     *
     * This should only be used if the user requires that their exec processes be the pid 1 process in the container. Otherwise it may result in unexpected behavior.
     */
    dockerBuild: (opts?: DirectoryDockerBuildOpts) => Container;
    /**
     * Returns a list of files and directories at the given path.
     * @param opts.path Location of the directory to look at (e.g., "/src").
     */
    entries: (opts?: DirectoryEntriesOpts) => Promise<string[]>;
    /**
     * Writes the contents of the directory to a path on the host.
     * @param path Location of the copied directory (e.g., "logs/").
     * @param opts.wipe If true, then the host directory will be wiped clean before exporting so that it exactly matches the directory being exported; this means it will delete any files on the host that aren't in the exported dir. If false (the default), the contents of the directory will be merged with any existing contents of the host directory, leaving any existing files on the host that aren't in the exported directory alone.
     */
    export: (path: string, opts?: DirectoryExportOpts) => Promise<string>;
    /**
     * Retrieve a file at the given path.
     * @param path Location of the file to retrieve (e.g., "README.md").
     */
    file: (path: string) => File;
    /**
     * Return a snapshot with some paths included or excluded
     * @param opts.exclude If set, paths matching one of these glob patterns is excluded from the new snapshot. Example: ["node_modules/", ".git*", ".env"]
     * @param opts.include If set, only paths matching one of these glob patterns is included in the new snapshot. Example: (e.g., ["app/", "package.*"]).
     */
    filter: (opts?: DirectoryFilterOpts) => Directory;
    /**
     * Returns a list of files and directories that matche the given pattern.
     * @param pattern Pattern to match (e.g., "*.md").
     */
    glob: (pattern: string) => Promise<string[]>;
    /**
     * Returns the name of the directory.
     */
    name: () => Promise<string>;
    /**
     * Force evaluation in the engine.
     */
    sync: () => Promise<Directory>;
    /**
     * Opens an interactive terminal in new container with this directory mounted inside.
     * @param opts.container If set, override the default container used for the terminal.
     * @param opts.cmd If set, override the container's default terminal command and invoke these command arguments instead.
     * @param opts.experimentalPrivilegedNesting Provides Dagger access to the executed command.
     * @param opts.insecureRootCapabilities Execute the command with all root capabilities. This is similar to running a command with "sudo" or executing "docker run" with the "--privileged" flag. Containerization does not provide any security guarantees when using this option. It should only be used when absolutely necessary and only with trusted commands.
     */
    terminal: (opts?: DirectoryTerminalOpts) => Directory;
    /**
     * Return a snapshot with a directory added
     * @param path Location of the written directory (e.g., "/src/").
     * @param directory Identifier of the directory to copy.
     * @param opts.exclude Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     * @param opts.include Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     */
    withDirectory: (path: string, directory: Directory, opts?: DirectoryWithDirectoryOpts) => Directory;
    /**
     * Retrieves this directory plus the contents of the given file copied to the given path.
     * @param path Location of the copied file (e.g., "/file.txt").
     * @param source Identifier of the file to copy.
     * @param opts.permissions Permission given to the copied file (e.g., 0600).
     */
    withFile: (path: string, source: File, opts?: DirectoryWithFileOpts) => Directory;
    /**
     * Retrieves this directory plus the contents of the given files copied to the given path.
     * @param path Location where copied files should be placed (e.g., "/src").
     * @param sources Identifiers of the files to copy.
     * @param opts.permissions Permission given to the copied files (e.g., 0600).
     */
    withFiles: (path: string, sources: File[], opts?: DirectoryWithFilesOpts) => Directory;
    /**
     * Retrieves this directory plus a new directory created at the given path.
     * @param path Location of the directory created (e.g., "/logs").
     * @param opts.permissions Permission granted to the created directory (e.g., 0777).
     */
    withNewDirectory: (path: string, opts?: DirectoryWithNewDirectoryOpts) => Directory;
    /**
     * Return a snapshot with a new file added
     * @param path Path of the new file. Example: "foo/bar.txt"
     * @param contents Contents of the new file. Example: "Hello world!"
     * @param opts.permissions Permissions of the new file. Example: 0600
     */
    withNewFile: (path: string, contents: string, opts?: DirectoryWithNewFileOpts) => Directory;
    /**
     * Return a snapshot with a symlink
     * @param target Location of the file or directory to link to (e.g., "/existing/file").
     * @param linkName Location where the symbolic link will be created (e.g., "/new-file-link").
     */
    withSymlink: (target: string, linkName: string) => Directory;
    /**
     * Retrieves this directory with all file/dir timestamps set to the given time.
     * @param timestamp Timestamp to set dir/files in.
     *
     * Formatted in seconds following Unix epoch (e.g., 1672531199).
     */
    withTimestamps: (timestamp: number) => Directory;
    /**
     * Return a snapshot with a subdirectory removed
     * @param path Path of the subdirectory to remove. Example: ".github/workflows"
     */
    withoutDirectory: (path: string) => Directory;
    /**
     * Return a snapshot with a file removed
     * @param path Path of the file to remove (e.g., "/file.txt").
     */
    withoutFile: (path: string) => Directory;
    /**
     * Return a snapshot with files removed
     * @param paths Paths of the files to remove (e.g., ["/file.txt"]).
     */
    withoutFiles: (paths: string[]) => Directory;
    /**
     * Call the provided function with current Directory.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Directory) => Directory) => Directory;
}
/**
 * The Dagger engine configuration and state
 */
declare class Engine extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EngineID);
    /**
     * A unique identifier for this Engine.
     */
    id: () => Promise<EngineID>;
    /**
     * The local (on-disk) cache for the Dagger engine
     */
    localCache: () => EngineCache;
}
/**
 * A cache storage for the Dagger engine
 */
declare class EngineCache extends BaseClient {
    private readonly _id?;
    private readonly _keepBytes?;
    private readonly _maxUsedSpace?;
    private readonly _minFreeSpace?;
    private readonly _prune?;
    private readonly _reservedSpace?;
    private readonly _targetSpace?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EngineCacheID, _keepBytes?: number, _maxUsedSpace?: number, _minFreeSpace?: number, _prune?: Void, _reservedSpace?: number, _targetSpace?: number);
    /**
     * A unique identifier for this EngineCache.
     */
    id: () => Promise<EngineCacheID>;
    /**
     * The current set of entries in the cache
     */
    entrySet: (opts?: EngineCacheEntrySetOpts) => EngineCacheEntrySet;
    /**
     * The maximum bytes to keep in the cache without pruning, after which automatic pruning may kick in.
     * @deprecated Use minFreeSpace instead.
     */
    keepBytes: () => Promise<number>;
    /**
     * The maximum bytes to keep in the cache without pruning.
     */
    maxUsedSpace: () => Promise<number>;
    /**
     * The target amount of free disk space the garbage collector will attempt to leave.
     */
    minFreeSpace: () => Promise<number>;
    /**
     * Prune the cache of releaseable entries
     * @param opts.useDefaultPolicy Use the engine-wide default pruning policy if true, otherwise prune the whole cache of any releasable entries.
     */
    prune: (opts?: EngineCachePruneOpts) => Promise<void>;
    /**
     * The minimum amount of disk space this policy is guaranteed to retain.
     */
    reservedSpace: () => Promise<number>;
    /**
     * The target number of bytes to keep when pruning.
     */
    targetSpace: () => Promise<number>;
}
/**
 * An individual cache entry in a cache entry set
 */
declare class EngineCacheEntry extends BaseClient {
    private readonly _id?;
    private readonly _activelyUsed?;
    private readonly _createdTimeUnixNano?;
    private readonly _description?;
    private readonly _diskSpaceBytes?;
    private readonly _mostRecentUseTimeUnixNano?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EngineCacheEntryID, _activelyUsed?: boolean, _createdTimeUnixNano?: number, _description?: string, _diskSpaceBytes?: number, _mostRecentUseTimeUnixNano?: number);
    /**
     * A unique identifier for this EngineCacheEntry.
     */
    id: () => Promise<EngineCacheEntryID>;
    /**
     * Whether the cache entry is actively being used.
     */
    activelyUsed: () => Promise<boolean>;
    /**
     * The time the cache entry was created, in Unix nanoseconds.
     */
    createdTimeUnixNano: () => Promise<number>;
    /**
     * The description of the cache entry.
     */
    description: () => Promise<string>;
    /**
     * The disk space used by the cache entry.
     */
    diskSpaceBytes: () => Promise<number>;
    /**
     * The most recent time the cache entry was used, in Unix nanoseconds.
     */
    mostRecentUseTimeUnixNano: () => Promise<number>;
}
/**
 * A set of cache entries returned by a query to a cache
 */
declare class EngineCacheEntrySet extends BaseClient {
    private readonly _id?;
    private readonly _diskSpaceBytes?;
    private readonly _entryCount?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EngineCacheEntrySetID, _diskSpaceBytes?: number, _entryCount?: number);
    /**
     * A unique identifier for this EngineCacheEntrySet.
     */
    id: () => Promise<EngineCacheEntrySetID>;
    /**
     * The total disk space used by the cache entries in this set.
     */
    diskSpaceBytes: () => Promise<number>;
    /**
     * The list of individual cache entries in the set
     */
    entries: () => Promise<EngineCacheEntry[]>;
    /**
     * The number of cache entries in this set.
     */
    entryCount: () => Promise<number>;
}
/**
 * A definition of a custom enum defined in a Module.
 */
declare class EnumTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _sourceModuleName?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EnumTypeDefID, _description?: string, _name?: string, _sourceModuleName?: string);
    /**
     * A unique identifier for this EnumTypeDef.
     */
    id: () => Promise<EnumTypeDefID>;
    /**
     * A doc string for the enum, if any.
     */
    description: () => Promise<string>;
    /**
     * The members of the enum.
     */
    members: () => Promise<EnumValueTypeDef[]>;
    /**
     * The name of the enum.
     */
    name: () => Promise<string>;
    /**
     * The location of this enum declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * If this EnumTypeDef is associated with a Module, the name of the module. Unset otherwise.
     */
    sourceModuleName: () => Promise<string>;
    /**
     * @deprecated use members instead
     */
    values: () => Promise<EnumValueTypeDef[]>;
}
/**
 * A definition of a value in a custom enum defined in a Module.
 */
declare class EnumValueTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _value?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EnumValueTypeDefID, _description?: string, _name?: string, _value?: string);
    /**
     * A unique identifier for this EnumValueTypeDef.
     */
    id: () => Promise<EnumValueTypeDefID>;
    /**
     * A doc string for the enum member, if any.
     */
    description: () => Promise<string>;
    /**
     * The name of the enum member.
     */
    name: () => Promise<string>;
    /**
     * The location of this enum member declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * The value of the enum member
     */
    value: () => Promise<string>;
}
declare class Env extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EnvID);
    /**
     * A unique identifier for this Env.
     */
    id: () => Promise<EnvID>;
    /**
     * retrieve an input value by name
     */
    input: (name: string) => Binding;
    /**
     * return all input values for the environment
     */
    inputs: () => Promise<Binding[]>;
    /**
     * retrieve an output value by name
     */
    output: (name: string) => Binding;
    /**
     * return all output values for the environment
     */
    outputs: () => Promise<Binding[]>;
    /**
     * Create or update a binding of type CacheVolume in the environment
     * @param name The name of the binding
     * @param value The CacheVolume value to assign to the binding
     * @param description The purpose of the input
     */
    withCacheVolumeInput: (name: string, value: CacheVolume, description: string) => Env;
    /**
     * Declare a desired CacheVolume output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withCacheVolumeOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Cloud in the environment
     * @param name The name of the binding
     * @param value The Cloud value to assign to the binding
     * @param description The purpose of the input
     */
    withCloudInput: (name: string, value: Cloud, description: string) => Env;
    /**
     * Declare a desired Cloud output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withCloudOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Container in the environment
     * @param name The name of the binding
     * @param value The Container value to assign to the binding
     * @param description The purpose of the input
     */
    withContainerInput: (name: string, value: Container, description: string) => Env;
    /**
     * Declare a desired Container output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withContainerOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Directory in the environment
     * @param name The name of the binding
     * @param value The Directory value to assign to the binding
     * @param description The purpose of the input
     */
    withDirectoryInput: (name: string, value: Directory, description: string) => Env;
    /**
     * Declare a desired Directory output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withDirectoryOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Env in the environment
     * @param name The name of the binding
     * @param value The Env value to assign to the binding
     * @param description The purpose of the input
     */
    withEnvInput: (name: string, value: Env, description: string) => Env;
    /**
     * Declare a desired Env output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withEnvOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type File in the environment
     * @param name The name of the binding
     * @param value The File value to assign to the binding
     * @param description The purpose of the input
     */
    withFileInput: (name: string, value: File, description: string) => Env;
    /**
     * Declare a desired File output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withFileOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type GitRef in the environment
     * @param name The name of the binding
     * @param value The GitRef value to assign to the binding
     * @param description The purpose of the input
     */
    withGitRefInput: (name: string, value: GitRef, description: string) => Env;
    /**
     * Declare a desired GitRef output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withGitRefOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type GitRepository in the environment
     * @param name The name of the binding
     * @param value The GitRepository value to assign to the binding
     * @param description The purpose of the input
     */
    withGitRepositoryInput: (name: string, value: GitRepository, description: string) => Env;
    /**
     * Declare a desired GitRepository output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withGitRepositoryOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type LLM in the environment
     * @param name The name of the binding
     * @param value The LLM value to assign to the binding
     * @param description The purpose of the input
     */
    withLLMInput: (name: string, value: LLM, description: string) => Env;
    /**
     * Declare a desired LLM output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withLLMOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type ModuleConfigClient in the environment
     * @param name The name of the binding
     * @param value The ModuleConfigClient value to assign to the binding
     * @param description The purpose of the input
     */
    withModuleConfigClientInput: (name: string, value: ModuleConfigClient, description: string) => Env;
    /**
     * Declare a desired ModuleConfigClient output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withModuleConfigClientOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Module in the environment
     * @param name The name of the binding
     * @param value The Module value to assign to the binding
     * @param description The purpose of the input
     */
    withModuleInput: (name: string, value: Module_, description: string) => Env;
    /**
     * Declare a desired Module output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withModuleOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type ModuleSource in the environment
     * @param name The name of the binding
     * @param value The ModuleSource value to assign to the binding
     * @param description The purpose of the input
     */
    withModuleSourceInput: (name: string, value: ModuleSource, description: string) => Env;
    /**
     * Declare a desired ModuleSource output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withModuleSourceOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Secret in the environment
     * @param name The name of the binding
     * @param value The Secret value to assign to the binding
     * @param description The purpose of the input
     */
    withSecretInput: (name: string, value: Secret, description: string) => Env;
    /**
     * Declare a desired Secret output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withSecretOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Service in the environment
     * @param name The name of the binding
     * @param value The Service value to assign to the binding
     * @param description The purpose of the input
     */
    withServiceInput: (name: string, value: Service, description: string) => Env;
    /**
     * Declare a desired Service output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withServiceOutput: (name: string, description: string) => Env;
    /**
     * Create or update a binding of type Socket in the environment
     * @param name The name of the binding
     * @param value The Socket value to assign to the binding
     * @param description The purpose of the input
     */
    withSocketInput: (name: string, value: Socket, description: string) => Env;
    /**
     * Declare a desired Socket output to be assigned in the environment
     * @param name The name of the binding
     * @param description A description of the desired value of the binding
     */
    withSocketOutput: (name: string, description: string) => Env;
    /**
     * Create or update an input value of type string
     * @param name The name of the binding
     * @param value The string value to assign to the binding
     * @param description The description of the input
     */
    withStringInput: (name: string, value: string, description: string) => Env;
    /**
     * Create or update an input value of type string
     * @param name The name of the binding
     * @param description The description of the output
     */
    withStringOutput: (name: string, description: string) => Env;
    /**
     * Call the provided function with current Env.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Env) => Env) => Env;
}
/**
 * An environment variable name and value.
 */
declare class EnvVariable extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _value?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: EnvVariableID, _name?: string, _value?: string);
    /**
     * A unique identifier for this EnvVariable.
     */
    id: () => Promise<EnvVariableID>;
    /**
     * The environment variable name.
     */
    name: () => Promise<string>;
    /**
     * The environment variable value.
     */
    value: () => Promise<string>;
}
declare class Error$1 extends BaseClient {
    private readonly _id?;
    private readonly _message?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ErrorID, _message?: string);
    /**
     * A unique identifier for this Error.
     */
    id: () => Promise<ErrorID>;
    /**
     * A description of the error.
     */
    message: () => Promise<string>;
    /**
     * The extensions of the error.
     */
    values: () => Promise<ErrorValue[]>;
    /**
     * Add a value to the error.
     * @param name The name of the value.
     * @param value The value to store on the error.
     */
    withValue: (name: string, value: JSON) => Error$1;
    /**
     * Call the provided function with current Error.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Error$1) => Error$1) => Error$1;
}
declare class ErrorValue extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _value?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ErrorValueID, _name?: string, _value?: JSON);
    /**
     * A unique identifier for this ErrorValue.
     */
    id: () => Promise<ErrorValueID>;
    /**
     * The name of the value.
     */
    name: () => Promise<string>;
    /**
     * The value.
     */
    value: () => Promise<JSON>;
}
/**
 * A definition of a field on a custom object defined in a Module.
 *
 * A field on an object has a static value, as opposed to a function on an object whose value is computed by invoking code (and can accept arguments).
 */
declare class FieldTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FieldTypeDefID, _description?: string, _name?: string);
    /**
     * A unique identifier for this FieldTypeDef.
     */
    id: () => Promise<FieldTypeDefID>;
    /**
     * A doc string for the field, if any.
     */
    description: () => Promise<string>;
    /**
     * The name of the field in lowerCamelCase format.
     */
    name: () => Promise<string>;
    /**
     * The location of this field declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * The type of the field.
     */
    typeDef: () => TypeDef;
}
/**
 * A file.
 */
declare class File extends BaseClient {
    private readonly _id?;
    private readonly _contents?;
    private readonly _digest?;
    private readonly _export?;
    private readonly _name?;
    private readonly _size?;
    private readonly _sync?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FileID, _contents?: string, _digest?: string, _export?: string, _name?: string, _size?: number, _sync?: FileID);
    /**
     * A unique identifier for this File.
     */
    id: () => Promise<FileID>;
    /**
     * Retrieves the contents of the file.
     */
    contents: () => Promise<string>;
    /**
     * Return the file's digest. The format of the digest is not guaranteed to be stable between releases of Dagger. It is guaranteed to be stable between invocations of the same Dagger engine.
     * @param opts.excludeMetadata If true, exclude metadata from the digest.
     */
    digest: (opts?: FileDigestOpts) => Promise<string>;
    /**
     * Writes the file to a file path on the host.
     * @param path Location of the written directory (e.g., "output.txt").
     * @param opts.allowParentDirPath If allowParentDirPath is true, the path argument can be a directory path, in which case the file will be created in that directory.
     */
    export: (path: string, opts?: FileExportOpts) => Promise<string>;
    /**
     * Retrieves the name of the file.
     */
    name: () => Promise<string>;
    /**
     * Retrieves the size of the file, in bytes.
     */
    size: () => Promise<number>;
    /**
     * Force evaluation in the engine.
     */
    sync: () => Promise<File>;
    /**
     * Retrieves this file with its name set to the given name.
     * @param name Name to set file to.
     */
    withName: (name: string) => File;
    /**
     * Retrieves this file with its created/modified timestamps set to the given time.
     * @param timestamp Timestamp to set dir/files in.
     *
     * Formatted in seconds following Unix epoch (e.g., 1672531199).
     */
    withTimestamps: (timestamp: number) => File;
    /**
     * Call the provided function with current File.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: File) => File) => File;
}
/**
 * Function represents a resolver provided by a Module.
 *
 * A function always evaluates against a parent object and is given a set of named arguments.
 */
declare class Function_ extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FunctionID, _description?: string, _name?: string);
    /**
     * A unique identifier for this Function.
     */
    id: () => Promise<FunctionID>;
    /**
     * Arguments accepted by the function, if any.
     */
    args: () => Promise<FunctionArg[]>;
    /**
     * A doc string for the function, if any.
     */
    description: () => Promise<string>;
    /**
     * The name of the function.
     */
    name: () => Promise<string>;
    /**
     * The type returned by the function.
     */
    returnType: () => TypeDef;
    /**
     * The location of this function declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * Returns the function with the provided argument
     * @param name The name of the argument
     * @param typeDef The type of the argument
     * @param opts.description A doc string for the argument, if any
     * @param opts.defaultValue A default value to use for this argument if not explicitly set by the caller, if any
     * @param opts.defaultPath If the argument is a Directory or File type, default to load path from context directory, relative to root directory.
     * @param opts.ignore Patterns to ignore when loading the contextual argument value.
     * @param opts.sourceMap The source map for the argument definition.
     */
    withArg: (name: string, typeDef: TypeDef, opts?: FunctionWithArgOpts) => Function_;
    /**
     * Returns the function with the given doc string.
     * @param description The doc string to set.
     */
    withDescription: (description: string) => Function_;
    /**
     * Returns the function with the given source map.
     * @param sourceMap The source map for the function definition.
     */
    withSourceMap: (sourceMap: SourceMap) => Function_;
    /**
     * Call the provided function with current Function.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Function_) => Function_) => Function_;
}
/**
 * An argument accepted by a function.
 *
 * This is a specification for an argument at function definition time, not an argument passed at function call time.
 */
declare class FunctionArg extends BaseClient {
    private readonly _id?;
    private readonly _defaultPath?;
    private readonly _defaultValue?;
    private readonly _description?;
    private readonly _name?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FunctionArgID, _defaultPath?: string, _defaultValue?: JSON, _description?: string, _name?: string);
    /**
     * A unique identifier for this FunctionArg.
     */
    id: () => Promise<FunctionArgID>;
    /**
     * Only applies to arguments of type File or Directory. If the argument is not set, load it from the given path in the context directory
     */
    defaultPath: () => Promise<string>;
    /**
     * A default value to use for this argument when not explicitly set by the caller, if any.
     */
    defaultValue: () => Promise<JSON>;
    /**
     * A doc string for the argument, if any.
     */
    description: () => Promise<string>;
    /**
     * Only applies to arguments of type Directory. The ignore patterns are applied to the input directory, and matching entries are filtered out, in a cache-efficient manner.
     */
    ignore: () => Promise<string[]>;
    /**
     * The name of the argument in lowerCamelCase format.
     */
    name: () => Promise<string>;
    /**
     * The location of this arg declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * The type of the argument.
     */
    typeDef: () => TypeDef;
}
/**
 * An active function call.
 */
declare class FunctionCall extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _parent?;
    private readonly _parentName?;
    private readonly _returnError?;
    private readonly _returnValue?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FunctionCallID, _name?: string, _parent?: JSON, _parentName?: string, _returnError?: Void, _returnValue?: Void);
    /**
     * A unique identifier for this FunctionCall.
     */
    id: () => Promise<FunctionCallID>;
    /**
     * The argument values the function is being invoked with.
     */
    inputArgs: () => Promise<FunctionCallArgValue[]>;
    /**
     * The name of the function being called.
     */
    name: () => Promise<string>;
    /**
     * The value of the parent object of the function being called. If the function is top-level to the module, this is always an empty object.
     */
    parent: () => Promise<JSON>;
    /**
     * The name of the parent object of the function being called. If the function is top-level to the module, this is the name of the module.
     */
    parentName: () => Promise<string>;
    /**
     * Return an error from the function.
     * @param error The error to return.
     */
    returnError: (error: Error$1) => Promise<void>;
    /**
     * Set the return value of the function call to the provided value.
     * @param value JSON serialization of the return value.
     */
    returnValue: (value: JSON) => Promise<void>;
}
/**
 * A value passed as a named argument to a function call.
 */
declare class FunctionCallArgValue extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _value?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: FunctionCallArgValueID, _name?: string, _value?: JSON);
    /**
     * A unique identifier for this FunctionCallArgValue.
     */
    id: () => Promise<FunctionCallArgValueID>;
    /**
     * The name of the argument.
     */
    name: () => Promise<string>;
    /**
     * The value of the argument represented as a JSON serialized string.
     */
    value: () => Promise<JSON>;
}
/**
 * The result of running an SDK's codegen.
 */
declare class GeneratedCode extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: GeneratedCodeID);
    /**
     * A unique identifier for this GeneratedCode.
     */
    id: () => Promise<GeneratedCodeID>;
    /**
     * The directory containing the generated code.
     */
    code: () => Directory;
    /**
     * List of paths to mark generated in version control (i.e. .gitattributes).
     */
    vcsGeneratedPaths: () => Promise<string[]>;
    /**
     * List of paths to ignore in version control (i.e. .gitignore).
     */
    vcsIgnoredPaths: () => Promise<string[]>;
    /**
     * Set the list of paths to mark generated in version control.
     */
    withVCSGeneratedPaths: (paths: string[]) => GeneratedCode;
    /**
     * Set the list of paths to ignore in version control.
     */
    withVCSIgnoredPaths: (paths: string[]) => GeneratedCode;
    /**
     * Call the provided function with current GeneratedCode.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: GeneratedCode) => GeneratedCode) => GeneratedCode;
}
/**
 * A git ref (tag, branch, or commit).
 */
declare class GitRef extends BaseClient {
    private readonly _id?;
    private readonly _commit?;
    private readonly _ref?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: GitRefID, _commit?: string, _ref?: string);
    /**
     * A unique identifier for this GitRef.
     */
    id: () => Promise<GitRefID>;
    /**
     * The resolved commit id at this ref.
     */
    commit: () => Promise<string>;
    /**
     * The resolved ref name at this ref.
     */
    ref: () => Promise<string>;
    /**
     * The filesystem tree at this ref.
     * @param opts.discardGitDir Set to true to discard .git directory.
     * @param opts.depth The depth of the tree to fetch.
     */
    tree: (opts?: GitRefTreeOpts) => Directory;
}
/**
 * A git repository.
 */
declare class GitRepository extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: GitRepositoryID);
    /**
     * A unique identifier for this GitRepository.
     */
    id: () => Promise<GitRepositoryID>;
    /**
     * Returns details of a branch.
     * @param name Branch's name (e.g., "main").
     */
    branch: (name: string) => GitRef;
    /**
     * branches that match any of the given glob patterns.
     * @param opts.patterns Glob patterns (e.g., "refs/tags/v*").
     */
    branches: (opts?: GitRepositoryBranchesOpts) => Promise<string[]>;
    /**
     * Returns details of a commit.
     * @param id Identifier of the commit (e.g., "b6315d8f2810962c601af73f86831f6866ea798b").
     */
    commit: (id: string) => GitRef;
    /**
     * Returns details for HEAD.
     */
    head: () => GitRef;
    /**
     * Returns details of a ref.
     * @param name Ref's name (can be a commit identifier, a tag name, a branch name, or a fully-qualified ref).
     */
    ref: (name: string) => GitRef;
    /**
     * Returns details of a tag.
     * @param name Tag's name (e.g., "v0.3.9").
     */
    tag: (name: string) => GitRef;
    /**
     * tags that match any of the given glob patterns.
     * @param opts.patterns Glob patterns (e.g., "refs/tags/v*").
     */
    tags: (opts?: GitRepositoryTagsOpts) => Promise<string[]>;
    /**
     * Header to authenticate the remote with.
     * @param header Secret used to populate the Authorization HTTP header
     * @deprecated Use "httpAuthHeader" in the constructor instead.
     */
    withAuthHeader: (header: Secret) => GitRepository;
    /**
     * Token to authenticate the remote with.
     * @param token Secret used to populate the password during basic HTTP Authorization
     * @deprecated Use "httpAuthToken" in the constructor instead.
     */
    withAuthToken: (token: Secret) => GitRepository;
    /**
     * Call the provided function with current GitRepository.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: GitRepository) => GitRepository) => GitRepository;
}
/**
 * Information about the host environment.
 */
declare class Host extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: HostID);
    /**
     * A unique identifier for this Host.
     */
    id: () => Promise<HostID>;
    /**
     * Accesses a directory on the host.
     * @param path Location of the directory to access (e.g., ".").
     * @param opts.exclude Exclude artifacts that match the given pattern (e.g., ["node_modules/", ".git*"]).
     * @param opts.include Include only artifacts that match the given pattern (e.g., ["app/", "package.*"]).
     * @param opts.noCache If true, the directory will always be reloaded from the host.
     */
    directory: (path: string, opts?: HostDirectoryOpts) => Directory;
    /**
     * Accesses a file on the host.
     * @param path Location of the file to retrieve (e.g., "README.md").
     * @param opts.noCache If true, the file will always be reloaded from the host.
     */
    file: (path: string, opts?: HostFileOpts) => File;
    /**
     * Creates a service that forwards traffic to a specified address via the host.
     * @param ports Ports to expose via the service, forwarding through the host network.
     *
     * If a port's frontend is unspecified or 0, it defaults to the same as the backend port.
     *
     * An empty set of ports is not valid; an error will be returned.
     * @param opts.host Upstream host to forward traffic to.
     */
    service: (ports: PortForward[], opts?: HostServiceOpts) => Service;
    /**
     * Sets a secret given a user-defined name and the file path on the host, and returns the secret.
     *
     * The file is limited to a size of 512000 bytes.
     * @param name The user defined name for this secret.
     * @param path Location of the file to set as a secret.
     * @deprecated setSecretFile is superceded by use of the secret API with file:// URIs
     */
    setSecretFile: (name: string, path: string) => Secret;
    /**
     * Creates a tunnel that forwards traffic from the host to a service.
     * @param service Service to send traffic from the tunnel.
     * @param opts.native Map each service port to the same port on the host, as if the service were running natively.
     *
     * Note: enabling may result in port conflicts.
     * @param opts.ports Configure explicit port forwarding rules for the tunnel.
     *
     * If a port's frontend is unspecified or 0, a random port will be chosen by the host.
     *
     * If no ports are given, all of the service's ports are forwarded. If native is true, each port maps to the same port on the host. If native is false, each port maps to a random port chosen by the host.
     *
     * If ports are given and native is true, the ports are additive.
     */
    tunnel: (service: Service, opts?: HostTunnelOpts) => Service;
    /**
     * Accesses a Unix socket on the host.
     * @param path Location of the Unix socket (e.g., "/var/run/docker.sock").
     */
    unixSocket: (path: string) => Socket;
}
/**
 * A graphql input type, which is essentially just a group of named args.
 * This is currently only used to represent pre-existing usage of graphql input types
 * in the core API. It is not used by user modules and shouldn't ever be as user
 * module accept input objects via their id rather than graphql input types.
 */
declare class InputTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: InputTypeDefID, _name?: string);
    /**
     * A unique identifier for this InputTypeDef.
     */
    id: () => Promise<InputTypeDefID>;
    /**
     * Static fields defined on this input object, if any.
     */
    fields: () => Promise<FieldTypeDef[]>;
    /**
     * The name of the input object.
     */
    name: () => Promise<string>;
}
/**
 * A definition of a custom interface defined in a Module.
 */
declare class InterfaceTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _sourceModuleName?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: InterfaceTypeDefID, _description?: string, _name?: string, _sourceModuleName?: string);
    /**
     * A unique identifier for this InterfaceTypeDef.
     */
    id: () => Promise<InterfaceTypeDefID>;
    /**
     * The doc string for the interface, if any.
     */
    description: () => Promise<string>;
    /**
     * Functions defined on this interface, if any.
     */
    functions: () => Promise<Function_[]>;
    /**
     * The name of the interface.
     */
    name: () => Promise<string>;
    /**
     * The location of this interface declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * If this InterfaceTypeDef is associated with a Module, the name of the module. Unset otherwise.
     */
    sourceModuleName: () => Promise<string>;
}
declare class LLM extends BaseClient {
    private readonly _id?;
    private readonly _historyJSON?;
    private readonly _lastReply?;
    private readonly _model?;
    private readonly _provider?;
    private readonly _sync?;
    private readonly _tools?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: LLMID, _historyJSON?: JSON, _lastReply?: string, _model?: string, _provider?: string, _sync?: LLMID, _tools?: string);
    /**
     * A unique identifier for this LLM.
     */
    id: () => Promise<LLMID>;
    /**
     * create a branch in the LLM's history
     */
    attempt: (number_: number) => LLM;
    /**
     * returns the type of the current state
     */
    bindResult: (name: string) => Binding;
    /**
     * return the LLM's current environment
     */
    env: () => Env;
    /**
     * return the llm message history
     */
    history: () => Promise<string[]>;
    /**
     * return the raw llm message history as json
     */
    historyJSON: () => Promise<JSON>;
    /**
     * return the last llm reply from the history
     */
    lastReply: () => Promise<string>;
    /**
     * synchronize LLM state
     */
    loop: () => LLM;
    /**
     * return the model used by the llm
     */
    model: () => Promise<string>;
    /**
     * return the provider used by the llm
     */
    provider: () => Promise<string>;
    /**
     * synchronize LLM state
     */
    sync: () => Promise<LLM>;
    /**
     * returns the token usage of the current state
     */
    tokenUsage: () => LLMTokenUsage;
    /**
     * print documentation for available tools
     */
    tools: () => Promise<string>;
    /**
     * allow the LLM to interact with an environment via MCP
     */
    withEnv: (env: Env) => LLM;
    /**
     * swap out the llm model
     * @param model The model to use
     */
    withModel: (model: string) => LLM;
    /**
     * append a prompt to the llm context
     * @param prompt The prompt to send
     */
    withPrompt: (prompt: string) => LLM;
    /**
     * append the contents of a file to the llm context
     * @param file The file to read the prompt from
     */
    withPromptFile: (file: File) => LLM;
    /**
     * Add a system prompt to the LLM's environment
     * @param prompt The system prompt to send
     */
    withSystemPrompt: (prompt: string) => LLM;
    /**
     * Disable the default system prompt
     */
    withoutDefaultSystemPrompt: () => LLM;
    /**
     * Call the provided function with current LLM.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: LLM) => LLM) => LLM;
}
declare class LLMTokenUsage extends BaseClient {
    private readonly _id?;
    private readonly _cachedTokenReads?;
    private readonly _cachedTokenWrites?;
    private readonly _inputTokens?;
    private readonly _outputTokens?;
    private readonly _totalTokens?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: LLMTokenUsageID, _cachedTokenReads?: number, _cachedTokenWrites?: number, _inputTokens?: number, _outputTokens?: number, _totalTokens?: number);
    /**
     * A unique identifier for this LLMTokenUsage.
     */
    id: () => Promise<LLMTokenUsageID>;
    cachedTokenReads: () => Promise<number>;
    cachedTokenWrites: () => Promise<number>;
    inputTokens: () => Promise<number>;
    outputTokens: () => Promise<number>;
    totalTokens: () => Promise<number>;
}
/**
 * A simple key value object that represents a label.
 */
declare class Label extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _value?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: LabelID, _name?: string, _value?: string);
    /**
     * A unique identifier for this Label.
     */
    id: () => Promise<LabelID>;
    /**
     * The label name.
     */
    name: () => Promise<string>;
    /**
     * The label value.
     */
    value: () => Promise<string>;
}
/**
 * A definition of a list type in a Module.
 */
declare class ListTypeDef extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ListTypeDefID);
    /**
     * A unique identifier for this ListTypeDef.
     */
    id: () => Promise<ListTypeDefID>;
    /**
     * The type of the elements in the list.
     */
    elementTypeDef: () => TypeDef;
}
/**
 * A Dagger module.
 */
declare class Module_ extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _serve?;
    private readonly _sync?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ModuleID, _description?: string, _name?: string, _serve?: Void, _sync?: ModuleID);
    /**
     * A unique identifier for this Module.
     */
    id: () => Promise<ModuleID>;
    /**
     * The dependencies of the module.
     */
    dependencies: () => Promise<Module_[]>;
    /**
     * The doc string of the module, if any
     */
    description: () => Promise<string>;
    /**
     * Enumerations served by this module.
     */
    enums: () => Promise<TypeDef[]>;
    /**
     * The generated files and directories made on top of the module source's context directory.
     */
    generatedContextDirectory: () => Directory;
    /**
     * Interfaces served by this module.
     */
    interfaces: () => Promise<TypeDef[]>;
    /**
     * The name of the module
     */
    name: () => Promise<string>;
    /**
     * Objects served by this module.
     */
    objects: () => Promise<TypeDef[]>;
    /**
     * The container that runs the module's entrypoint. It will fail to execute if the module doesn't compile.
     */
    runtime: () => Container;
    /**
     * The SDK config used by this module.
     */
    sdk: () => SDKConfig;
    /**
     * Serve a module's API in the current session.
     *
     * Note: this can only be called once per session. In the future, it could return a stream or service to remove the side effect.
     * @param opts.includeDependencies Expose the dependencies of this module to the client
     */
    serve: (opts?: ModuleServeOpts) => Promise<void>;
    /**
     * The source for the module.
     */
    source: () => ModuleSource;
    /**
     * Forces evaluation of the module, including any loading into the engine and associated validation.
     */
    sync: () => Promise<Module_>;
    /**
     * Retrieves the module with the given description
     * @param description The description to set
     */
    withDescription: (description: string) => Module_;
    /**
     * This module plus the given Enum type and associated values
     */
    withEnum: (enum_: TypeDef) => Module_;
    /**
     * This module plus the given Interface type and associated functions
     */
    withInterface: (iface: TypeDef) => Module_;
    /**
     * This module plus the given Object type and associated functions.
     */
    withObject: (object: TypeDef) => Module_;
    /**
     * Call the provided function with current Module.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Module_) => Module_) => Module_;
}
/**
 * The client generated for the module.
 */
declare class ModuleConfigClient extends BaseClient {
    private readonly _id?;
    private readonly _directory?;
    private readonly _generator?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ModuleConfigClientID, _directory?: string, _generator?: string);
    /**
     * A unique identifier for this ModuleConfigClient.
     */
    id: () => Promise<ModuleConfigClientID>;
    /**
     * The directory the client is generated in.
     */
    directory: () => Promise<string>;
    /**
     * The generator to use
     */
    generator: () => Promise<string>;
}
/**
 * The source needed to load and run a module, along with any metadata about the source such as versions/urls/etc.
 */
declare class ModuleSource extends BaseClient {
    private readonly _id?;
    private readonly _asString?;
    private readonly _cloneRef?;
    private readonly _commit?;
    private readonly _configExists?;
    private readonly _digest?;
    private readonly _engineVersion?;
    private readonly _htmlRepoURL?;
    private readonly _htmlURL?;
    private readonly _kind?;
    private readonly _localContextDirectoryPath?;
    private readonly _moduleName?;
    private readonly _moduleOriginalName?;
    private readonly _originalSubpath?;
    private readonly _pin?;
    private readonly _repoRootPath?;
    private readonly _sourceRootSubpath?;
    private readonly _sourceSubpath?;
    private readonly _sync?;
    private readonly _version?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ModuleSourceID, _asString?: string, _cloneRef?: string, _commit?: string, _configExists?: boolean, _digest?: string, _engineVersion?: string, _htmlRepoURL?: string, _htmlURL?: string, _kind?: ModuleSourceKind, _localContextDirectoryPath?: string, _moduleName?: string, _moduleOriginalName?: string, _originalSubpath?: string, _pin?: string, _repoRootPath?: string, _sourceRootSubpath?: string, _sourceSubpath?: string, _sync?: ModuleSourceID, _version?: string);
    /**
     * A unique identifier for this ModuleSource.
     */
    id: () => Promise<ModuleSourceID>;
    /**
     * Load the source as a module. If this is a local source, the parent directory must have been provided during module source creation
     */
    asModule: () => Module_;
    /**
     * A human readable ref string representation of this module source.
     */
    asString: () => Promise<string>;
    /**
     * The ref to clone the root of the git repo from. Only valid for git sources.
     */
    cloneRef: () => Promise<string>;
    /**
     * The resolved commit of the git repo this source points to.
     */
    commit: () => Promise<string>;
    /**
     * The clients generated for the module.
     */
    configClients: () => Promise<ModuleConfigClient[]>;
    /**
     * Whether an existing dagger.json for the module was found.
     */
    configExists: () => Promise<boolean>;
    /**
     * The full directory loaded for the module source, including the source code as a subdirectory.
     */
    contextDirectory: () => Directory;
    /**
     * The dependencies of the module source.
     */
    dependencies: () => Promise<ModuleSource[]>;
    /**
     * A content-hash of the module source. Module sources with the same digest will output the same generated context and convert into the same module instance.
     */
    digest: () => Promise<string>;
    /**
     * The directory containing the module configuration and source code (source code may be in a subdir).
     * @param path A subpath from the source directory to select.
     */
    directory: (path: string) => Directory;
    /**
     * The engine version of the module.
     */
    engineVersion: () => Promise<string>;
    /**
     * The generated files and directories made on top of the module source's context directory.
     */
    generatedContextDirectory: () => Directory;
    /**
     * The URL to access the web view of the repository (e.g., GitHub, GitLab, Bitbucket).
     */
    htmlRepoURL: () => Promise<string>;
    /**
     * The URL to the source's git repo in a web browser. Only valid for git sources.
     */
    htmlURL: () => Promise<string>;
    /**
     * The kind of module source (currently local, git or dir).
     */
    kind: () => Promise<ModuleSourceKind>;
    /**
     * The full absolute path to the context directory on the caller's host filesystem that this module source is loaded from. Only valid for local module sources.
     */
    localContextDirectoryPath: () => Promise<string>;
    /**
     * The name of the module, including any setting via the withName API.
     */
    moduleName: () => Promise<string>;
    /**
     * The original name of the module as read from the module's dagger.json (or set for the first time with the withName API).
     */
    moduleOriginalName: () => Promise<string>;
    /**
     * The original subpath used when instantiating this module source, relative to the context directory.
     */
    originalSubpath: () => Promise<string>;
    /**
     * The pinned version of this module source.
     */
    pin: () => Promise<string>;
    /**
     * The import path corresponding to the root of the git repo this source points to. Only valid for git sources.
     */
    repoRootPath: () => Promise<string>;
    /**
     * The SDK configuration of the module.
     */
    sdk: () => SDKConfig;
    /**
     * The path, relative to the context directory, that contains the module's dagger.json.
     */
    sourceRootSubpath: () => Promise<string>;
    /**
     * The path to the directory containing the module's source code, relative to the context directory.
     */
    sourceSubpath: () => Promise<string>;
    /**
     * Forces evaluation of the module source, including any loading into the engine and associated validation.
     */
    sync: () => Promise<ModuleSource>;
    /**
     * The specified version of the git repo this source points to.
     */
    version: () => Promise<string>;
    /**
     * Update the module source with a new client to generate.
     * @param generator The generator to use
     * @param outputDir The output directory for the generated client.
     */
    withClient: (generator: string, outputDir: string) => ModuleSource;
    /**
     * Append the provided dependencies to the module source's dependency list.
     * @param dependencies The dependencies to append.
     */
    withDependencies: (dependencies: ModuleSource[]) => ModuleSource;
    /**
     * Upgrade the engine version of the module to the given value.
     * @param version The engine version to upgrade to.
     */
    withEngineVersion: (version: string) => ModuleSource;
    /**
     * Update the module source with additional include patterns for files+directories from its context that are required for building it
     * @param patterns The new additional include patterns.
     */
    withIncludes: (patterns: string[]) => ModuleSource;
    /**
     * Update the module source with a new name.
     * @param name The name to set.
     */
    withName: (name: string) => ModuleSource;
    /**
     * Update the module source with a new SDK.
     * @param source The SDK source to set.
     */
    withSDK: (source: string) => ModuleSource;
    /**
     * Update the module source with a new source subpath.
     * @param path The path to set as the source subpath. Must be relative to the module source's source root directory.
     */
    withSourceSubpath: (path: string) => ModuleSource;
    /**
     * Update one or more module dependencies.
     * @param dependencies The dependencies to update.
     */
    withUpdateDependencies: (dependencies: string[]) => ModuleSource;
    /**
     * Remove a client from the module source.
     * @param path The path of the client to remove.
     */
    withoutClient: (path: string) => ModuleSource;
    /**
     * Remove the provided dependencies from the module source's dependency list.
     * @param dependencies The dependencies to remove.
     */
    withoutDependencies: (dependencies: string[]) => ModuleSource;
    /**
     * Call the provided function with current ModuleSource.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: ModuleSource) => ModuleSource) => ModuleSource;
}
/**
 * A definition of a custom object defined in a Module.
 */
declare class ObjectTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _sourceModuleName?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ObjectTypeDefID, _description?: string, _name?: string, _sourceModuleName?: string);
    /**
     * A unique identifier for this ObjectTypeDef.
     */
    id: () => Promise<ObjectTypeDefID>;
    /**
     * The function used to construct new instances of this object, if any
     */
    constructor_: () => Function_;
    /**
     * The doc string for the object, if any.
     */
    description: () => Promise<string>;
    /**
     * Static fields defined on this object, if any.
     */
    fields: () => Promise<FieldTypeDef[]>;
    /**
     * Functions defined on this object, if any.
     */
    functions: () => Promise<Function_[]>;
    /**
     * The name of the object.
     */
    name: () => Promise<string>;
    /**
     * The location of this object declaration.
     */
    sourceMap: () => SourceMap;
    /**
     * If this ObjectTypeDef is associated with a Module, the name of the module. Unset otherwise.
     */
    sourceModuleName: () => Promise<string>;
}
/**
 * A port exposed by a container.
 */
declare class Port extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _experimentalSkipHealthcheck?;
    private readonly _port?;
    private readonly _protocol?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: PortID, _description?: string, _experimentalSkipHealthcheck?: boolean, _port?: number, _protocol?: NetworkProtocol);
    /**
     * A unique identifier for this Port.
     */
    id: () => Promise<PortID>;
    /**
     * The port description.
     */
    description: () => Promise<string>;
    /**
     * Skip the health check when run as a service.
     */
    experimentalSkipHealthcheck: () => Promise<boolean>;
    /**
     * The port number.
     */
    port: () => Promise<number>;
    /**
     * The transport layer protocol.
     */
    protocol: () => Promise<NetworkProtocol>;
}
/**
 * The root of the DAG.
 */
declare class Client extends BaseClient {
    private readonly _defaultPlatform?;
    private readonly _version?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _defaultPlatform?: Platform, _version?: string);
    /**
     * Get the Raw GraphQL client.
     */
    getGQLClient(): graphql_request.GraphQLClient;
    /**
     * Constructs a cache volume for a given cache key.
     * @param key A string identifier to target this cache volume (e.g., "modules-cache").
     */
    cacheVolume: (key: string) => CacheVolume;
    /**
     * Dagger Cloud configuration and state
     */
    cloud: () => Cloud;
    /**
     * Creates a scratch container, with no image or metadata.
     *
     * To pull an image, follow up with the "from" function.
     * @param opts.platform Platform to initialize the container with. Defaults to the native platform of the current engine
     */
    container: (opts?: ClientContainerOpts) => Container;
    /**
     * The FunctionCall context that the SDK caller is currently executing in.
     *
     * If the caller is not currently executing in a function, this will return an error.
     */
    currentFunctionCall: () => FunctionCall;
    /**
     * The module currently being served in the session, if any.
     */
    currentModule: () => CurrentModule;
    /**
     * The TypeDef representations of the objects currently being served in the session.
     */
    currentTypeDefs: () => Promise<TypeDef[]>;
    /**
     * The default platform of the engine.
     */
    defaultPlatform: () => Promise<Platform>;
    /**
     * Creates an empty directory.
     */
    directory: () => Directory;
    /**
     * The Dagger engine container configuration and state
     */
    engine: () => Engine;
    /**
     * Initialize a new environment
     * @param opts.privileged Give the environment the same privileges as the caller: core API including host access, current module, and dependencies
     * @param opts.writable Allow new outputs to be declared and saved in the environment
     * @experimental
     */
    env: (opts?: ClientEnvOpts) => Env;
    /**
     * Create a new error.
     * @param message A brief description of the error.
     */
    error: (message: string) => Error$1;
    /**
     * Creates a file with the specified contents.
     * @param name Name of the new file. Example: "foo.txt"
     * @param contents Contents of the new file. Example: "Hello world!"
     * @param opts.permissions Permissions of the new file. Example: 0600
     */
    file: (name: string, contents: string, opts?: ClientFileOpts) => File;
    /**
     * Creates a function.
     * @param name Name of the function, in its original format from the implementation language.
     * @param returnType Return type of the function.
     */
    function_: (name: string, returnType: TypeDef) => Function_;
    /**
     * Create a code generation result, given a directory containing the generated code.
     */
    generatedCode: (code: Directory) => GeneratedCode;
    /**
     * Queries a Git repository.
     * @param url URL of the git repository.
     *
     * Can be formatted as `https://{host}/{owner}/{repo}`, `git@{host}:{owner}/{repo}`.
     *
     * Suffix ".git" is optional.
     * @param opts.keepGitDir DEPRECATED: Set to true to keep .git directory.
     * @param opts.sshKnownHosts Set SSH known hosts
     * @param opts.sshAuthSocket Set SSH auth socket
     * @param opts.httpAuthUsername Username used to populate the password during basic HTTP Authorization
     * @param opts.httpAuthToken Secret used to populate the password during basic HTTP Authorization
     * @param opts.httpAuthHeader Secret used to populate the Authorization HTTP header
     * @param opts.experimentalServiceHost A service which must be started before the repo is fetched.
     */
    git: (url: string, opts?: ClientGitOpts) => GitRepository;
    /**
     * Queries the host environment.
     */
    host: () => Host;
    /**
     * Returns a file containing an http remote url content.
     * @param url HTTP url to get the content from (e.g., "https://docs.dagger.io").
     * @param opts.name File name to use for the file. Defaults to the last part of the URL.
     * @param opts.permissions Permissions to set on the file.
     * @param opts.authHeader Secret used to populate the Authorization HTTP header
     * @param opts.experimentalServiceHost A service which must be started before the URL is fetched.
     */
    http: (url: string, opts?: ClientHttpOpts) => File;
    /**
     * Initialize a Large Language Model (LLM)
     * @param opts.model Model to use
     * @param opts.maxAPICalls Cap the number of API calls for this LLM
     * @experimental
     */
    llm: (opts?: ClientLlmOpts) => LLM;
    /**
     * Load a Binding from its ID.
     */
    loadBindingFromID: (id: BindingID) => Binding;
    /**
     * Load a CacheVolume from its ID.
     */
    loadCacheVolumeFromID: (id: CacheVolumeID) => CacheVolume;
    /**
     * Load a Cloud from its ID.
     */
    loadCloudFromID: (id: CloudID) => Cloud;
    /**
     * Load a Container from its ID.
     */
    loadContainerFromID: (id: ContainerID) => Container;
    /**
     * Load a CurrentModule from its ID.
     */
    loadCurrentModuleFromID: (id: CurrentModuleID) => CurrentModule;
    /**
     * Load a Directory from its ID.
     */
    loadDirectoryFromID: (id: DirectoryID) => Directory;
    /**
     * Load a EngineCacheEntry from its ID.
     */
    loadEngineCacheEntryFromID: (id: EngineCacheEntryID) => EngineCacheEntry;
    /**
     * Load a EngineCacheEntrySet from its ID.
     */
    loadEngineCacheEntrySetFromID: (id: EngineCacheEntrySetID) => EngineCacheEntrySet;
    /**
     * Load a EngineCache from its ID.
     */
    loadEngineCacheFromID: (id: EngineCacheID) => EngineCache;
    /**
     * Load a Engine from its ID.
     */
    loadEngineFromID: (id: EngineID) => Engine;
    /**
     * Load a EnumTypeDef from its ID.
     */
    loadEnumTypeDefFromID: (id: EnumTypeDefID) => EnumTypeDef;
    /**
     * Load a EnumValueTypeDef from its ID.
     */
    loadEnumValueTypeDefFromID: (id: EnumValueTypeDefID) => EnumValueTypeDef;
    /**
     * Load a Env from its ID.
     */
    loadEnvFromID: (id: EnvID) => Env;
    /**
     * Load a EnvVariable from its ID.
     */
    loadEnvVariableFromID: (id: EnvVariableID) => EnvVariable;
    /**
     * Load a Error from its ID.
     */
    loadErrorFromID: (id: ErrorID) => Error$1;
    /**
     * Load a ErrorValue from its ID.
     */
    loadErrorValueFromID: (id: ErrorValueID) => ErrorValue;
    /**
     * Load a FieldTypeDef from its ID.
     */
    loadFieldTypeDefFromID: (id: FieldTypeDefID) => FieldTypeDef;
    /**
     * Load a File from its ID.
     */
    loadFileFromID: (id: FileID) => File;
    /**
     * Load a FunctionArg from its ID.
     */
    loadFunctionArgFromID: (id: FunctionArgID) => FunctionArg;
    /**
     * Load a FunctionCallArgValue from its ID.
     */
    loadFunctionCallArgValueFromID: (id: FunctionCallArgValueID) => FunctionCallArgValue;
    /**
     * Load a FunctionCall from its ID.
     */
    loadFunctionCallFromID: (id: FunctionCallID) => FunctionCall;
    /**
     * Load a Function from its ID.
     */
    loadFunctionFromID: (id: FunctionID) => Function_;
    /**
     * Load a GeneratedCode from its ID.
     */
    loadGeneratedCodeFromID: (id: GeneratedCodeID) => GeneratedCode;
    /**
     * Load a GitRef from its ID.
     */
    loadGitRefFromID: (id: GitRefID) => GitRef;
    /**
     * Load a GitRepository from its ID.
     */
    loadGitRepositoryFromID: (id: GitRepositoryID) => GitRepository;
    /**
     * Load a Host from its ID.
     */
    loadHostFromID: (id: HostID) => Host;
    /**
     * Load a InputTypeDef from its ID.
     */
    loadInputTypeDefFromID: (id: InputTypeDefID) => InputTypeDef;
    /**
     * Load a InterfaceTypeDef from its ID.
     */
    loadInterfaceTypeDefFromID: (id: InterfaceTypeDefID) => InterfaceTypeDef;
    /**
     * Load a LLM from its ID.
     */
    loadLLMFromID: (id: LLMID) => LLM;
    /**
     * Load a LLMTokenUsage from its ID.
     */
    loadLLMTokenUsageFromID: (id: LLMTokenUsageID) => LLMTokenUsage;
    /**
     * Load a Label from its ID.
     */
    loadLabelFromID: (id: LabelID) => Label;
    /**
     * Load a ListTypeDef from its ID.
     */
    loadListTypeDefFromID: (id: ListTypeDefID) => ListTypeDef;
    /**
     * Load a ModuleConfigClient from its ID.
     */
    loadModuleConfigClientFromID: (id: ModuleConfigClientID) => ModuleConfigClient;
    /**
     * Load a Module from its ID.
     */
    loadModuleFromID: (id: ModuleID) => Module_;
    /**
     * Load a ModuleSource from its ID.
     */
    loadModuleSourceFromID: (id: ModuleSourceID) => ModuleSource;
    /**
     * Load a ObjectTypeDef from its ID.
     */
    loadObjectTypeDefFromID: (id: ObjectTypeDefID) => ObjectTypeDef;
    /**
     * Load a Port from its ID.
     */
    loadPortFromID: (id: PortID) => Port;
    /**
     * Load a SDKConfig from its ID.
     */
    loadSDKConfigFromID: (id: SDKConfigID) => SDKConfig;
    /**
     * Load a ScalarTypeDef from its ID.
     */
    loadScalarTypeDefFromID: (id: ScalarTypeDefID) => ScalarTypeDef;
    /**
     * Load a Secret from its ID.
     */
    loadSecretFromID: (id: SecretID) => Secret;
    /**
     * Load a Service from its ID.
     */
    loadServiceFromID: (id: ServiceID) => Service;
    /**
     * Load a Socket from its ID.
     */
    loadSocketFromID: (id: SocketID) => Socket;
    /**
     * Load a SourceMap from its ID.
     */
    loadSourceMapFromID: (id: SourceMapID) => SourceMap;
    /**
     * Load a Terminal from its ID.
     */
    loadTerminalFromID: (id: TerminalID) => Terminal;
    /**
     * Load a TypeDef from its ID.
     */
    loadTypeDefFromID: (id: TypeDefID) => TypeDef;
    /**
     * Create a new module.
     */
    module_: () => Module_;
    /**
     * Create a new module source instance from a source ref string
     * @param refString The string ref representation of the module source
     * @param opts.refPin The pinned version of the module source
     * @param opts.disableFindUp If true, do not attempt to find dagger.json in a parent directory of the provided path. Only relevant for local module sources.
     * @param opts.allowNotExists If true, do not error out if the provided ref string is a local path and does not exist yet. Useful when initializing new modules in directories that don't exist yet.
     * @param opts.requireKind If set, error out if the ref string is not of the provided requireKind.
     */
    moduleSource: (refString: string, opts?: ClientModuleSourceOpts) => ModuleSource;
    /**
     * Creates a new secret.
     * @param uri The URI of the secret store
     * @param opts.cacheKey If set, the given string will be used as the cache key for this secret. This means that any secrets with the same cache key will be considered equivalent in terms of cache lookups, even if they have different URIs or plaintext values.
     *
     * For example, two secrets with the same cache key provided as secret env vars to other wise equivalent containers will result in the container withExecs hitting the cache for each other.
     *
     * If not set, the cache key for the secret will be derived from its plaintext value as looked up when the secret is constructed.
     */
    secret: (uri: string, opts?: ClientSecretOpts) => Secret;
    /**
     * Sets a secret given a user defined name to its plaintext and returns the secret.
     *
     * The plaintext value is limited to a size of 128000 bytes.
     * @param name The user defined name for this secret
     * @param plaintext The plaintext of the secret
     */
    setSecret: (name: string, plaintext: string) => Secret;
    /**
     * Creates source map metadata.
     * @param filename The filename from the module source.
     * @param line The line number within the filename.
     * @param column The column number within the line.
     */
    sourceMap: (filename: string, line: number, column: number) => SourceMap;
    /**
     * Create a new TypeDef.
     */
    typeDef: () => TypeDef;
    /**
     * Get the current Dagger Engine version.
     */
    version: () => Promise<string>;
}
/**
 * The SDK config of the module.
 */
declare class SDKConfig extends BaseClient {
    private readonly _id?;
    private readonly _source?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: SDKConfigID, _source?: string);
    /**
     * A unique identifier for this SDKConfig.
     */
    id: () => Promise<SDKConfigID>;
    /**
     * Source of the SDK. Either a name of a builtin SDK or a module source ref string pointing to the SDK's implementation.
     */
    source: () => Promise<string>;
}
/**
 * A definition of a custom scalar defined in a Module.
 */
declare class ScalarTypeDef extends BaseClient {
    private readonly _id?;
    private readonly _description?;
    private readonly _name?;
    private readonly _sourceModuleName?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ScalarTypeDefID, _description?: string, _name?: string, _sourceModuleName?: string);
    /**
     * A unique identifier for this ScalarTypeDef.
     */
    id: () => Promise<ScalarTypeDefID>;
    /**
     * A doc string for the scalar, if any.
     */
    description: () => Promise<string>;
    /**
     * The name of the scalar.
     */
    name: () => Promise<string>;
    /**
     * If this ScalarTypeDef is associated with a Module, the name of the module. Unset otherwise.
     */
    sourceModuleName: () => Promise<string>;
}
/**
 * A reference to a secret value, which can be handled more safely than the value itself.
 */
declare class Secret extends BaseClient {
    private readonly _id?;
    private readonly _name?;
    private readonly _plaintext?;
    private readonly _uri?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: SecretID, _name?: string, _plaintext?: string, _uri?: string);
    /**
     * A unique identifier for this Secret.
     */
    id: () => Promise<SecretID>;
    /**
     * The name of this secret.
     */
    name: () => Promise<string>;
    /**
     * The value of this secret.
     */
    plaintext: () => Promise<string>;
    /**
     * The URI of this secret.
     */
    uri: () => Promise<string>;
}
/**
 * A content-addressed service providing TCP connectivity.
 */
declare class Service extends BaseClient {
    private readonly _id?;
    private readonly _endpoint?;
    private readonly _hostname?;
    private readonly _start?;
    private readonly _stop?;
    private readonly _up?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: ServiceID, _endpoint?: string, _hostname?: string, _start?: ServiceID, _stop?: ServiceID, _up?: Void);
    /**
     * A unique identifier for this Service.
     */
    id: () => Promise<ServiceID>;
    /**
     * Retrieves an endpoint that clients can use to reach this container.
     *
     * If no port is specified, the first exposed port is used. If none exist an error is returned.
     *
     * If a scheme is specified, a URL is returned. Otherwise, a host:port pair is returned.
     * @param opts.port The exposed port number for the endpoint
     * @param opts.scheme Return a URL with the given scheme, eg. http for http://
     */
    endpoint: (opts?: ServiceEndpointOpts) => Promise<string>;
    /**
     * Retrieves a hostname which can be used by clients to reach this container.
     */
    hostname: () => Promise<string>;
    /**
     * Retrieves the list of ports provided by the service.
     */
    ports: () => Promise<Port[]>;
    /**
     * Start the service and wait for its health checks to succeed.
     *
     * Services bound to a Container do not need to be manually started.
     */
    start: () => Promise<Service>;
    /**
     * Stop the service.
     * @param opts.kill Immediately kill the service without waiting for a graceful exit
     */
    stop: (opts?: ServiceStopOpts) => Promise<Service>;
    /**
     * Creates a tunnel that forwards traffic from the caller's network to this service.
     * @param opts.ports List of frontend/backend port mappings to forward.
     *
     * Frontend is the port accepting traffic on the host, backend is the service port.
     * @param opts.random Bind each tunnel port to a random port on the host.
     */
    up: (opts?: ServiceUpOpts) => Promise<void>;
    /**
     * Configures a hostname which can be used by clients within the session to reach this container.
     * @param hostname The hostname to use.
     */
    withHostname: (hostname: string) => Service;
    /**
     * Call the provided function with current Service.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: Service) => Service) => Service;
}
/**
 * A Unix or TCP/IP socket that can be mounted into a container.
 */
declare class Socket extends BaseClient {
    private readonly _id?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: SocketID);
    /**
     * A unique identifier for this Socket.
     */
    id: () => Promise<SocketID>;
}
/**
 * Source location information.
 */
declare class SourceMap extends BaseClient {
    private readonly _id?;
    private readonly _column?;
    private readonly _filename?;
    private readonly _line?;
    private readonly _module?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: SourceMapID, _column?: number, _filename?: string, _line?: number, _module?: string);
    /**
     * A unique identifier for this SourceMap.
     */
    id: () => Promise<SourceMapID>;
    /**
     * The column number within the line.
     */
    column: () => Promise<number>;
    /**
     * The filename from the module source.
     */
    filename: () => Promise<string>;
    /**
     * The line number within the filename.
     */
    line: () => Promise<number>;
    /**
     * The module dependency this was declared in.
     */
    module_: () => Promise<string>;
}
/**
 * An interactive terminal that clients can connect to.
 */
declare class Terminal extends BaseClient {
    private readonly _id?;
    private readonly _sync?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: TerminalID, _sync?: TerminalID);
    /**
     * A unique identifier for this Terminal.
     */
    id: () => Promise<TerminalID>;
    /**
     * Forces evaluation of the pipeline in the engine.
     *
     * It doesn't run the default command if no exec has been set.
     */
    sync: () => Promise<Terminal>;
}
/**
 * A definition of a parameter or return type in a Module.
 */
declare class TypeDef extends BaseClient {
    private readonly _id?;
    private readonly _kind?;
    private readonly _optional?;
    /**
     * Constructor is used for internal usage only, do not create object from it.
     */
    constructor(ctx?: Context, _id?: TypeDefID, _kind?: TypeDefKind, _optional?: boolean);
    /**
     * A unique identifier for this TypeDef.
     */
    id: () => Promise<TypeDefID>;
    /**
     * If kind is ENUM, the enum-specific type definition. If kind is not ENUM, this will be null.
     */
    asEnum: () => EnumTypeDef;
    /**
     * If kind is INPUT, the input-specific type definition. If kind is not INPUT, this will be null.
     */
    asInput: () => InputTypeDef;
    /**
     * If kind is INTERFACE, the interface-specific type definition. If kind is not INTERFACE, this will be null.
     */
    asInterface: () => InterfaceTypeDef;
    /**
     * If kind is LIST, the list-specific type definition. If kind is not LIST, this will be null.
     */
    asList: () => ListTypeDef;
    /**
     * If kind is OBJECT, the object-specific type definition. If kind is not OBJECT, this will be null.
     */
    asObject: () => ObjectTypeDef;
    /**
     * If kind is SCALAR, the scalar-specific type definition. If kind is not SCALAR, this will be null.
     */
    asScalar: () => ScalarTypeDef;
    /**
     * The kind of type this is (e.g. primitive, list, object).
     */
    kind: () => Promise<TypeDefKind>;
    /**
     * Whether this type can be set to null. Defaults to false.
     */
    optional: () => Promise<boolean>;
    /**
     * Adds a function for constructing a new instance of an Object TypeDef, failing if the type is not an object.
     */
    withConstructor: (function_: Function_) => TypeDef;
    /**
     * Returns a TypeDef of kind Enum with the provided name.
     *
     * Note that an enum's values may be omitted if the intent is only to refer to an enum. This is how functions are able to return their own, or any other circular reference.
     * @param name The name of the enum
     * @param opts.description A doc string for the enum, if any
     * @param opts.sourceMap The source map for the enum definition.
     */
    withEnum: (name: string, opts?: TypeDefWithEnumOpts) => TypeDef;
    /**
     * Adds a static value for an Enum TypeDef, failing if the type is not an enum.
     * @param name The name of the member in the enum
     * @param opts.value The value of the member in the enum
     * @param opts.description A doc string for the member, if any
     * @param opts.sourceMap The source map for the enum member definition.
     */
    withEnumMember: (name: string, opts?: TypeDefWithEnumMemberOpts) => TypeDef;
    /**
     * Adds a static value for an Enum TypeDef, failing if the type is not an enum.
     * @param value The name of the value in the enum
     * @param opts.description A doc string for the value, if any
     * @param opts.sourceMap The source map for the enum value definition.
     * @deprecated Use withEnumMember instead
     */
    withEnumValue: (value: string, opts?: TypeDefWithEnumValueOpts) => TypeDef;
    /**
     * Adds a static field for an Object TypeDef, failing if the type is not an object.
     * @param name The name of the field in the object
     * @param typeDef The type of the field
     * @param opts.description A doc string for the field, if any
     * @param opts.sourceMap The source map for the field definition.
     */
    withField: (name: string, typeDef: TypeDef, opts?: TypeDefWithFieldOpts) => TypeDef;
    /**
     * Adds a function for an Object or Interface TypeDef, failing if the type is not one of those kinds.
     */
    withFunction: (function_: Function_) => TypeDef;
    /**
     * Returns a TypeDef of kind Interface with the provided name.
     */
    withInterface: (name: string, opts?: TypeDefWithInterfaceOpts) => TypeDef;
    /**
     * Sets the kind of the type.
     */
    withKind: (kind: TypeDefKind) => TypeDef;
    /**
     * Returns a TypeDef of kind List with the provided type for its elements.
     */
    withListOf: (elementType: TypeDef) => TypeDef;
    /**
     * Returns a TypeDef of kind Object with the provided name.
     *
     * Note that an object's fields and functions may be omitted if the intent is only to refer to an object. This is how functions are able to return their own object, or any other circular reference.
     */
    withObject: (name: string, opts?: TypeDefWithObjectOpts) => TypeDef;
    /**
     * Sets whether this type can be set to null.
     */
    withOptional: (optional: boolean) => TypeDef;
    /**
     * Returns a TypeDef of kind Scalar with the provided name.
     */
    withScalar: (name: string, opts?: TypeDefWithScalarOpts) => TypeDef;
    /**
     * Call the provided function with current TypeDef.
     *
     * This is useful for reusability and readability by not breaking the calling chain.
     */
    with: (arg: (param: TypeDef) => TypeDef) => TypeDef;
}
declare const dag: Client;

declare const ERROR_CODES: {
    /**
     * {@link GraphQLRequestError}
     */
    readonly GraphQLRequestError: "D100";
    /**
     * {@link UnknownDaggerError}
     */
    readonly UnknownDaggerError: "D101";
    /**
     * {@link TooManyNestedObjectsError}
     */
    readonly TooManyNestedObjectsError: "D102";
    /**
     * {@link EngineSessionConnectParamsParseError}
     */
    readonly EngineSessionConnectParamsParseError: "D103";
    /**
     * {@link EngineSessionConnectionTimeoutError}
     */
    readonly EngineSessionConnectionTimeoutError: "D104";
    /**
     * {@link EngineSessionError}
     */
    readonly EngineSessionError: "D105";
    /**
     * {@link InitEngineSessionBinaryError}
     */
    readonly InitEngineSessionBinaryError: "D106";
    /**
     * {@link DockerImageRefValidationError}
     */
    readonly DockerImageRefValidationError: "D107";
    /**
     * {@link NotAwaitedRequestError}
     */
    readonly NotAwaitedRequestError: "D108";
    /**
     * (@link ExecError}
     */
    readonly ExecError: "D109";
    /**
     * {@link IntrospectionError}
     */
    readonly IntrospectionError: "D110";
};
type ErrorCodesType = typeof ERROR_CODES;
type ErrorNames = keyof ErrorCodesType;
type ErrorCodes = ErrorCodesType[ErrorNames];

interface DaggerSDKErrorOptions {
    cause?: Error;
}
/**
 * The base error. Every other error inherits this error.
 */
declare abstract class DaggerSDKError extends Error {
    /**
     * The name of the dagger error.
     */
    abstract readonly name: ErrorNames;
    /**
     * The dagger specific error code.
     * Use this to identify dagger errors programmatically.
     */
    abstract readonly code: ErrorCodes;
    /**
     * The original error, which caused the DaggerSDKError.
     */
    cause?: Error;
    protected constructor(message: string, options?: DaggerSDKErrorOptions);
    /**
     * @hidden
     */
    get [Symbol.toStringTag](): "GraphQLRequestError" | "UnknownDaggerError" | "TooManyNestedObjectsError" | "EngineSessionConnectParamsParseError" | "EngineSessionConnectionTimeoutError" | "EngineSessionError" | "InitEngineSessionBinaryError" | "DockerImageRefValidationError" | "NotAwaitedRequestError" | "ExecError" | "IntrospectionError";
    /**
     * Pretty prints the error
     */
    printStackTrace(): void;
}

/**
 *  This error is thrown if the dagger SDK does not identify the error and just wraps the cause.
 */
declare class UnknownDaggerError extends DaggerSDKError {
    name: "UnknownDaggerError";
    code: "D101";
    /**
     * @hidden
     */
    constructor(message: string, options: DaggerSDKErrorOptions);
}

interface DockerImageRefValidationErrorOptions extends DaggerSDKErrorOptions {
    ref: string;
}
/**
 *  This error is thrown if the passed image reference does not pass validation and is not compliant with the
 *  DockerImage constructor.
 */
declare class DockerImageRefValidationError extends DaggerSDKError {
    name: "DockerImageRefValidationError";
    code: "D107";
    /**
     *  The docker image reference, which caused the error.
     */
    ref: string;
    /**
     *  @hidden
     */
    constructor(message: string, options: DockerImageRefValidationErrorOptions);
}

interface EngineSessionConnectParamsParseErrorOptions extends DaggerSDKErrorOptions {
    parsedLine: string;
}
/**
 * This error is thrown if the EngineSession does not manage to parse the required connection parameters from the session binary
 */
declare class EngineSessionConnectParamsParseError extends DaggerSDKError {
    name: "EngineSessionConnectParamsParseError";
    code: "D103";
    /**
     *  the line, which caused the error during parsing, if the error was caused because of parsing.
     */
    parsedLine: string;
    /**
     * @hidden
     */
    constructor(message: string, options: EngineSessionConnectParamsParseErrorOptions);
}

interface ExecErrorOptions extends DaggerSDKErrorOptions {
    cmd: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
    extensions?: GraphQLErrorExtensions;
}
/**
 *  API error from an exec operation in a pipeline.
 */
declare class ExecError extends DaggerSDKError {
    name: "ExecError";
    code: "D109";
    /**
     *  The command that caused the error.
     */
    cmd: string[];
    /**
     *  The exit code of the command.
     */
    exitCode: number;
    /**
     * The stdout of the command.
     */
    stdout: string;
    /**
     * The stderr of the command.
     */
    stderr: string;
    /**
     * GraphQL error extensions
     */
    extensions?: GraphQLErrorExtensions;
    /**
     *  @hidden
     */
    constructor(message: string, options: ExecErrorOptions);
}

interface GraphQLRequestErrorOptions extends DaggerSDKErrorOptions {
    error: ClientError;
}
/**
 *  This error originates from the dagger engine. It means that some error was thrown and sent back via GraphQL.
 */
declare class GraphQLRequestError extends DaggerSDKError {
    name: "GraphQLRequestError";
    code: "D100";
    /**
     *  The query and variables, which caused the error.
     */
    requestContext: ClientError["request"];
    /**
     *  the GraphQL response containing the error.
     */
    response: ClientError["response"];
    /**
     *  The GraphQL error extentions.
     */
    extensions?: GraphQLErrorExtensions;
    /**
     *  @hidden
     */
    constructor(message: string, options: GraphQLRequestErrorOptions);
}

/**
 *  This error is thrown if the dagger binary cannot be copied from the dagger docker image and copied to the local host.
 */
declare class InitEngineSessionBinaryError extends DaggerSDKError {
    name: "InitEngineSessionBinaryError";
    code: "D106";
    /**
     *  @hidden
     */
    constructor(message: string, options?: DaggerSDKErrorOptions);
}

interface TooManyNestedObjectsErrorOptions extends DaggerSDKErrorOptions {
    response: unknown;
}
/**
 *  Dagger only expects one response value from the engine. If the engine returns more than one value this error is thrown.
 */
declare class TooManyNestedObjectsError extends DaggerSDKError {
    name: "TooManyNestedObjectsError";
    code: "D102";
    /**
     *  the response containing more than one value.
     */
    response: unknown;
    /**
     * @hidden
     */
    constructor(message: string, options: TooManyNestedObjectsErrorOptions);
}

type EngineSessionErrorOptions = DaggerSDKErrorOptions;
/**
 * This error is thrown if the EngineSession does not manage to parse the required port successfully because a EOF is read before any valid port.
 * This usually happens if no connection can be established.
 */
declare class EngineSessionError extends DaggerSDKError {
    name: "EngineSessionError";
    code: "D105";
    /**
     * @hidden
     */
    constructor(message: string, options?: EngineSessionErrorOptions);
}

interface EngineSessionConnectionTimeoutErrorOptions extends DaggerSDKErrorOptions {
    timeOutDuration: number;
}
/**
 * This error is thrown if the EngineSession does not manage to parse the required port successfully because the sessions connection timed out.
 */
declare class EngineSessionConnectionTimeoutError extends DaggerSDKError {
    name: "EngineSessionConnectionTimeoutError";
    code: "D104";
    /**
     * The duration until the timeout occurred in ms.
     */
    timeOutDuration: number;
    /**
     * @hidden
     */
    constructor(message: string, options: EngineSessionConnectionTimeoutErrorOptions);
}

/**
 * This error is thrown when the compute function isn't awaited.
 */
declare class NotAwaitedRequestError extends DaggerSDKError {
    name: "NotAwaitedRequestError";
    code: "D108";
    /**
     * @hidden
     */
    constructor(message: string, options?: DaggerSDKErrorOptions);
}

declare class FunctionNotFound extends DaggerSDKError {
    name: "ExecError";
    code: "D109";
    constructor(message: string, options?: DaggerSDKErrorOptions);
}

declare class IntrospectionError extends DaggerSDKError {
    name: "IntrospectionError";
    code: "D110";
    constructor(message: string, options?: DaggerSDKErrorOptions);
}

/**
 * ConnectOpts defines option used to connect to an engine.
 */
interface ConnectOpts {
    /**
     * Use to overwrite Dagger workdir
     * @defaultValue process.cwd()
     */
    Workdir?: string;
    /**
       * Enable logs output
       * @example
       * LogOutput
       * ```ts
       * connect(async (client: Client) => {
      const source = await client.host().workdir().id()
      ...
      }, {LogOutput: process.stdout})
       ```
       */
    LogOutput?: Writable;
}

type CallbackFct = (client: Client) => Promise<void>;
/**
 * connection executes the given function using the default global Dagger client.
 *
 * @example
 * ```ts
 * await connection(
 *   async () => {
 *     await dag
 *       .container()
 *       .from("alpine")
 *       .withExec(["apk", "add", "curl"])
 *       .withExec(["curl", "https://dagger.io/"])
 *       .sync()
 *   }, { LogOutput: process.stderr }
 * )
 * ```
 */
declare function connection(fct: () => Promise<void>, cfg?: ConnectOpts): Promise<void>;
/**
 * connect runs GraphQL server and initializes a
 * GraphQL client to execute query on it through its callback.
 * This implementation is based on the existing Go SDK.
 */
declare function connect(cb: CallbackFct, config?: ConnectOpts): Promise<void>;

type Class = {
    new (...args: any[]): any;
};
type ArgumentOptions = {
    /**
     * The contextual value to use for the argument.
     *
     * This should only be used for Directory or File types.
     *
     * An abslute path would be related to the context source directory (the git repo root or the module source root).
     * A relative path would be relative to the module source root.
     */
    defaultPath?: string;
    /**
     * Patterns to ignore when loading the contextual argument value.
     *
     * This should only be used for Directory types.
     */
    ignore?: string[];
};

/**
 * The definition of the `@object` decorator that should be on top of any
 * class module that must be exposed to the Dagger API.
 *
 */
declare const object: () => (<T extends Class>(constructor: T) => T);
/**
 * The definition of @func decorator that should be on top of any
 * class' method that must be exposed to the Dagger API.
 *
 * @param alias The alias to use for the field when exposed on the API.
 */
declare const func: (alias?: string) => ((target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => void);
/**
 * The definition of @field decorator that should be on top of any
 * class' property that must be exposed to the Dagger API.
 *
 * @deprecated In favor of `@func`
 * @param alias The alias to use for the field when exposed on the API.
 */
declare const field: (alias?: string) => ((target: object, propertyKey: string) => void);
/**
 * The definition of the `@enumType` decorator that should be on top of any
 * class module that must be exposed to the Dagger API as enumeration.
 */
declare const enumType: () => (<T extends Class>(constructor: T) => T);
/**
 * Add a `@argument` decorator to an argument of type `Directory` or `File` to load
 * its contents from the module context directory.
 *
 * The context directory is the git repository containing the module.
 * If there's no git repository, the context directory is the directory containing
 * the module source code.
 *
 * @param opts.defaultPath Only applies to arguments of type File or Directory. If the argument is not set,
 * load it from the given path in the context directory.
 * @param opts.ignore Only applies to arguments of type Directory. The ignore patterns are applied to the input directory,
 * and matching entries are filtered out, in a cache-efficient manner..
 *
 * Relative paths are relative to the current source files.
 * Absolute paths are rooted to the module context directory.
 */
declare const argument: (opts?: ArgumentOptions) => ((target: object, propertyKey: string | undefined, parameterIndex: number) => void);

declare function entrypoint(files: string[]): Promise<void>;

export { Binding, CacheSharingMode, CacheVolume, Client, Cloud, Container, Context, CurrentModule, DaggerSDKError, Directory, DockerImageRefValidationError, ERROR_CODES, Engine, EngineCache, EngineCacheEntry, EngineCacheEntrySet, EngineSessionConnectParamsParseError, EngineSessionConnectionTimeoutError, EngineSessionError, EnumTypeDef, EnumValueTypeDef, Env, EnvVariable, Error$1 as Error, ErrorValue, ExecError, FieldTypeDef, File, FunctionArg, FunctionCall, FunctionCallArgValue, FunctionNotFound, Function_, GeneratedCode, GitRef, GitRepository, GraphQLRequestError, Host, ImageLayerCompression, ImageMediaTypes, InitEngineSessionBinaryError, InputTypeDef, InterfaceTypeDef, IntrospectionError, LLM, LLMTokenUsage, Label, ListTypeDef, ModuleConfigClient, ModuleSource, ModuleSourceKind, Module_, NetworkProtocol, NotAwaitedRequestError, ObjectTypeDef, Port, ReturnType, SDKConfig, ScalarTypeDef, Secret, Service, Socket, SourceMap, Terminal, TooManyNestedObjectsError, TypeDef, TypeDefKind, UnknownDaggerError, argument, connect, connection, dag, entrypoint, enumType, field, func, getTracer, object };
export type { BindingID, BuildArg, CacheVolumeID, CallbackFct, ClientContainerOpts, ClientEnvOpts, ClientFileOpts, ClientGitOpts, ClientHttpOpts, ClientLlmOpts, ClientModuleSourceOpts, ClientSecretOpts, CloudID, ConnectOpts, ContainerAsServiceOpts, ContainerAsTarballOpts, ContainerBuildOpts, ContainerDirectoryOpts, ContainerExportOpts, ContainerFileOpts, ContainerID, ContainerImportOpts, ContainerPublishOpts, ContainerTerminalOpts, ContainerUpOpts, ContainerWithDefaultTerminalCmdOpts, ContainerWithDirectoryOpts, ContainerWithEntrypointOpts, ContainerWithEnvVariableOpts, ContainerWithExecOpts, ContainerWithExposedPortOpts, ContainerWithFileOpts, ContainerWithFilesOpts, ContainerWithMountedCacheOpts, ContainerWithMountedDirectoryOpts, ContainerWithMountedFileOpts, ContainerWithMountedSecretOpts, ContainerWithMountedTempOpts, ContainerWithNewFileOpts, ContainerWithSymlinkOpts, ContainerWithUnixSocketOpts, ContainerWithWorkdirOpts, ContainerWithoutDirectoryOpts, ContainerWithoutEntrypointOpts, ContainerWithoutExposedPortOpts, ContainerWithoutFileOpts, ContainerWithoutFilesOpts, ContainerWithoutMountOpts, ContainerWithoutUnixSocketOpts, CurrentModuleID, CurrentModuleWorkdirOpts, DirectoryAsModuleOpts, DirectoryAsModuleSourceOpts, DirectoryDockerBuildOpts, DirectoryEntriesOpts, DirectoryExportOpts, DirectoryFilterOpts, DirectoryID, DirectoryTerminalOpts, DirectoryWithDirectoryOpts, DirectoryWithFileOpts, DirectoryWithFilesOpts, DirectoryWithNewDirectoryOpts, DirectoryWithNewFileOpts, EngineCacheEntryID, EngineCacheEntrySetID, EngineCacheEntrySetOpts, EngineCacheID, EngineCachePruneOpts, EngineID, EnumTypeDefID, EnumValueTypeDefID, EnvID, EnvVariableID, ErrorID, ErrorValueID, FieldTypeDefID, FileDigestOpts, FileExportOpts, FileID, FunctionArgID, FunctionCallArgValueID, FunctionCallID, FunctionID, FunctionWithArgOpts, GeneratedCodeID, GitRefID, GitRefTreeOpts, GitRepositoryBranchesOpts, GitRepositoryID, GitRepositoryTagsOpts, HostDirectoryOpts, HostFileOpts, HostID, HostServiceOpts, HostTunnelOpts, InputTypeDefID, InterfaceTypeDefID, JSON, LLMID, LLMTokenUsageID, LabelID, ListTypeDefID, ModuleConfigClientID, ModuleID, ModuleServeOpts, ModuleSourceID, ObjectTypeDefID, PipelineLabel, Platform, PortForward, PortID, SDKConfigID, ScalarTypeDefID, SecretID, ServiceEndpointOpts, ServiceID, ServiceStopOpts, ServiceUpOpts, SocketID, SourceMapID, TerminalID, TypeDefID, TypeDefWithEnumMemberOpts, TypeDefWithEnumOpts, TypeDefWithEnumValueOpts, TypeDefWithFieldOpts, TypeDefWithInterfaceOpts, TypeDefWithObjectOpts, TypeDefWithScalarOpts, Void, __TypeEnumValuesOpts, __TypeFieldsOpts, float };
