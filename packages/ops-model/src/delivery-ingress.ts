/** Fixed operator-owned human ingress; this is identity policy, never selected release state. */
export const DELIVERY_TAILSCALE_INGRESS = {
  namespace: "delivery",
  name: "delivery-operator-ingress",
  proxyNamespace: "tailscale",
  parentLabels: {
    "tailscale.com/managed": "true",
    "tailscale.com/parent-resource-type": "ingress",
    "tailscale.com/parent-resource-ns": "delivery",
    "tailscale.com/parent-resource": "delivery-operator-ingress",
  },
} as const;
