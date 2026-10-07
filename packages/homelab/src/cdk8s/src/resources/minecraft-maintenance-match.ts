/** Shared admission matching for Storm's exclusive data-volume maintenance. */
export function minecraftMaintenanceMatch(
  resource: "statefulsets" | "statefulsets/scale",
  operation: "UPDATE" | "DELETE" = "UPDATE",
) {
  return {
    failurePolicy: "Fail",
    matchConstraints: {
      matchPolicy: "Equivalent",
      resourceRules: [
        {
          apiGroups: ["apps"],
          apiVersions: ["v1"],
          operations: [operation],
          resources: [resource],
          scope: "Namespaced",
        },
      ],
    },
    matchConditions: [
      {
        name: "the-storm-server",
        expression:
          resource === "statefulsets" && operation === "UPDATE"
            ? "object.metadata.namespace == 'minecraft-tsmc' && object.metadata.name == 'minecraft-tsmc'"
            : "request.namespace == 'minecraft-tsmc' && request.name == 'minecraft-tsmc'",
      },
    ],
  };
}
