/**
 * The pod workspace volume is mode 0777. @swc/core rejects that as a
 * native-addon cache ancestor, so the cache lives under the job home and
 * uses the library's isolated-runtime opt-out. The cache file stays private.
 */
export const deliveryJobNativeAddonEnv = () => [
  { name: "SWC_NATIVE_BINDING_CACHE", value: "/workspace/home/.cache" },
  {
    name: "SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK",
    value: "1",
  },
];
