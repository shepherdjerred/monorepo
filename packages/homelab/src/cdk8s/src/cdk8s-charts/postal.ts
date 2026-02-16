import { App, Chart } from "cdk8s";
import { IntOrString, KubeNetworkPolicy } from "../../generated/imports/k8s.ts";
import { PostalMariaDB } from "../resources/postgres/postal-mariadb.ts";
import { createPostalDeployment } from "../resources/mail/postal.ts";

export function createPostalChart(app: App) {
  const chart = new Chart(app, "postal", {
    namespace: "postal",
    disableResourceNameHashes: true,
  });

  const postalMariadb = new PostalMariaDB(chart, "postal-mariadb", {
    namespace: "postal",
    storageClass: "zfs-ssd",
    storageSize: "32Gi",
  });

  createPostalDeployment(chart, {
    mariadb: postalMariadb,
  });

  // DNS records (rp.sjer.red, MX, SPF) are managed by OpenTofu (src/tofu/cloudflare/)

  // NetworkPolicy for Postal SMTP - allow inbound from other namespaces
  new KubeNetworkPolicy(chart, "postal-smtp-netpol", {
    metadata: { name: "postal-smtp-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "postal-smtp" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          // Allow SMTP from bugsink, plausible, and other namespaces
          from: [
            { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "bugsink" } } },
            { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "plausible" } } },
            { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "birmel" } } },
          ],
          ports: [{ port: IntOrString.fromNumber(25), protocol: "TCP" }],
        },
      ],
      egress: [
        // Allow DNS
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // Allow MariaDB within namespace
        {
          to: [{ podSelector: { matchLabels: { app: "postal-mariadb" } } }],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
        // Allow external SMTP relay to Fastmail
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(587), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for Postal Web - allow Tailscale access
  new KubeNetworkPolicy(chart, "postal-web-netpol", {
    metadata: { name: "postal-web-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "postal-web" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }],
          ports: [{ port: IntOrString.fromNumber(5000), protocol: "TCP" }],
        },
      ],
      egress: [
        // Allow DNS
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // Allow MariaDB within namespace
        {
          to: [{ podSelector: { matchLabels: { app: "postal-mariadb" } } }],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for Postal Worker - needs DB access and external SMTP relay
  new KubeNetworkPolicy(chart, "postal-worker-netpol", {
    metadata: { name: "postal-worker-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "postal-worker" } },
      policyTypes: ["Egress"],
      egress: [
        // Allow DNS
        {
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // Allow MariaDB within namespace
        {
          to: [{ podSelector: { matchLabels: { app: "postal-mariadb" } } }],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
        // Allow external SMTP relay to Fastmail (via postfix sidecar)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(587), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy for MariaDB - only allow postal components
  new KubeNetworkPolicy(chart, "postal-mariadb-netpol", {
    metadata: { name: "postal-mariadb-netpol" },
    spec: {
      podSelector: { matchLabels: { app: "postal-mariadb" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            { podSelector: { matchLabels: { app: "postal-smtp" } } },
            { podSelector: { matchLabels: { app: "postal-web" } } },
            { podSelector: { matchLabels: { app: "postal-worker" } } },
          ],
          ports: [{ port: IntOrString.fromNumber(3306), protocol: "TCP" }],
        },
      ],
    },
  });
}
