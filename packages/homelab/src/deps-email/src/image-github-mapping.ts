/**
 * Image repository to GitHub repository mapping
 */
export const IMAGE_TO_GITHUB: Record<string, string> = {
  // Prometheus ecosystem
  "prometheus/prometheus": "prometheus/prometheus",
  "prometheus/alertmanager": "prometheus/alertmanager",
  "prometheus/node-exporter": "prometheus/node_exporter",
  "prometheus/blackbox-exporter": "prometheus/blackbox_exporter",
  "prometheus/pushgateway": "prometheus/pushgateway",
  "prometheus-operator/prometheus-operator":
    "prometheus-operator/prometheus-operator",
  "prometheus-operator/prometheus-config-reloader":
    "prometheus-operator/prometheus-operator",
  "prometheus-operator/admission-webhook":
    "prometheus-operator/prometheus-operator",

  // Grafana ecosystem
  "grafana/grafana": "grafana/grafana",
  "grafana/loki": "grafana/loki",
  "grafana/promtail": "grafana/loki",
  "grafana/tempo": "grafana/tempo",
  "grafana/mimir": "grafana/mimir",

  // Kubernetes ecosystem
  "kube-state-metrics/kube-state-metrics": "kubernetes/kube-state-metrics",
  "ingress-nginx/controller": "kubernetes/ingress-nginx",
  "ingress-nginx/kube-webhook-certgen": "kubernetes/ingress-nginx",

  // Thanos
  "thanos/thanos": "thanos-io/thanos",

  // Other common images
  "kiwigrid/k8s-sidecar": "kiwigrid/k8s-sidecar",
  "jimmidyson/configmap-reload": "jimmidyson/configmap-reload",
  "quay.io/brancz/kube-rbac-proxy": "brancz/kube-rbac-proxy",
};
