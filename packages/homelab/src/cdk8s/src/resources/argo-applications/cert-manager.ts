import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy,
  CertificateSpecUsages,
  ClusterIssuer,
  Issuer,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/cert-manager.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

export const HOMELAB_CLUSTER_CA_SECRET = "homelab-cluster-ca";
export const HOMELAB_CLUSTER_ISSUER_NAME = "homelab-ca-issuer";
export const HOMELAB_CLUSTER_CA_FILE = "ca.crt";
export const HOMELAB_CLUSTER_TLS_CERTIFICATE_FILE = "tls.crt";
export const HOMELAB_CLUSTER_TLS_PRIVATE_KEY_FILE = "tls.key";

export type HomelabIssuedCertificateOptions = {
  name: string;
  namespace: string;
  secretName: string;
  commonName: string;
  dnsNames: string[];
  annotations?: Record<string, string>;
};

// Leaf certificates issued by the cluster CA. Clients must trust ca.crt from
// the resulting secret (the stable CA), never tls.crt, which rotates.
export function createHomelabIssuedCertificate(
  chart: Chart,
  id: string,
  options: HomelabIssuedCertificateOptions,
): Certificate {
  return new Certificate(chart, id, {
    metadata: {
      name: options.name,
      namespace: options.namespace,
      annotations: options.annotations,
    },
    spec: {
      secretName: options.secretName,
      commonName: options.commonName,
      dnsNames: options.dnsNames,
      duration: "8760h",
      renewBefore: "720h",
      issuerRef: {
        name: HOMELAB_CLUSTER_ISSUER_NAME,
        kind: "ClusterIssuer",
      },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.ALWAYS,
      },
      usages: [
        CertificateSpecUsages.SERVER_AUTH,
        CertificateSpecUsages.DIGITAL_SIGNATURE,
        CertificateSpecUsages.KEY_ENCIPHERMENT,
      ],
    },
  });
}

export function createCertManagerApp(chart: Chart) {
  new Issuer(chart, "cert-manager-self-signed-issuer", {
    metadata: {
      name: "cert-manager-self-signed",
      namespace: "cert-manager",
    },
    spec: { selfSigned: {} },
  });

  // Stable cluster CA. rotationPolicy is pinned to Never: cert-manager >=v1.18
  // defaults to Always, which would regenerate the trust anchor on every
  // renewal and break every client that mounted ca.crt.
  new Certificate(chart, "homelab-cluster-ca-certificate", {
    metadata: {
      name: HOMELAB_CLUSTER_CA_SECRET,
      namespace: "cert-manager",
    },
    spec: {
      secretName: HOMELAB_CLUSTER_CA_SECRET,
      commonName: "homelab-cluster-ca",
      isCa: true,
      duration: "87600h",
      renewBefore: "720h",
      issuerRef: { name: "cert-manager-self-signed", kind: "Issuer" },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.NEVER,
      },
      usages: [CertificateSpecUsages.CERT_SIGN, CertificateSpecUsages.CRL_SIGN],
    },
  });

  new ClusterIssuer(chart, "homelab-ca-cluster-issuer", {
    metadata: {
      name: HOMELAB_CLUSTER_ISSUER_NAME,
    },
    spec: {
      ca: { secretName: HOMELAB_CLUSTER_CA_SECRET },
    },
  });

  const certManagerValues: HelmValuesForChart<"cert-manager"> = {
    installCRDs: true,
    prometheus: {
      enabled: true,
      servicemonitor: {
        enabled: true,
      },
    },
    // Baseline requests (no limits) so cert renewal isn't BestEffort.
    // All three components idle under 10m / 150Mi (30d).
    resources: {
      requests: {
        cpu: "10m",
        memory: "128Mi",
      },
    },
    webhook: {
      resources: {
        requests: {
          cpu: "10m",
          memory: "64Mi",
        },
      },
    },
    cainjector: {
      resources: {
        requests: {
          cpu: "10m",
          memory: "128Mi",
        },
      },
    },
    // TODO: these were causing issues
    // webhook: {
    //   prometheus: {
    //     enabled: true,
    //     servicemonitor: {
    //       enabled: true,
    //     },
    //   },
    // },
    // cainjector: {
    //   prometheus: {
    //     enabled: true,
    //     servicemonitor: {
    //       enabled: true,
    //     },
    //   },
    // },
  };

  return new Application(chart, "cert-manager-app", {
    metadata: {
      name: "cert-manager",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://artifacthub.io/packages/search?org=cert-manager
        repoUrl: "https://charts.jetstack.io",
        chart: "cert-manager",
        targetRevision: versions["cert-manager"],
        helm: {
          valuesObject: certManagerValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "cert-manager",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
