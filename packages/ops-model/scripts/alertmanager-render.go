// Renders the Alertmanager ops-email.tmpl exactly as Alertmanager would
// (text/template for subject and text, html/template for HTML).
//
// Usage: go run alertmanager-render.go <template-file> [single|multi]
//
// Shared by the cdk8s alertmanager-routing test and the ops-model preview
// gallery so both exercise the real template.
package main

import (
	"bytes"
	"encoding/json"
	htmltemplate "html/template"
	"os"
	texttemplate "text/template"
)

type Alert struct {
	Status      string
	Labels      map[string]string
	Annotations map[string]string
}

type Alerts []Alert

func (a Alerts) Firing() Alerts {
	var out Alerts
	for _, item := range a {
		if item.Status == "firing" {
			out = append(out, item)
		}
	}
	return out
}

type Data struct {
	Receiver     string
	Status       string
	Alerts       Alerts
	CommonLabels map[string]string
}

func singleData() Data {
	return Data{
		Receiver: "postal-fallback",
		Status:   "firing",
		CommonLabels: map[string]string{
			"alertname":                "TemporalWorkflowNondeterministic",
			"severity":                 "critical",
			"alert_dashboard_fallback": "true",
		},
		Alerts: Alerts{
			{
				Status: "firing",
				Labels: map[string]string{
					"alertname":                "TemporalWorkflowNondeterministic",
					"severity":                 "critical",
					"namespace":                "temporal",
					"pod":                      "temporal-worker-7b9d8f-abc12",
					"node":                     "torvalds",
					"workflow_type":            "runHomelabAudit",
					"task_queue":               "monorepo-workflows",
					"instance":                 "10.244.0.48:9100",
					"job":                      "temporal-worker-metrics",
					"endpoint":                 "http-metrics",
					"prometheus":               "prometheus/prometheus-kube-prometheus-prometheus",
					"alert_dashboard_fallback": "true",
				},
				Annotations: map[string]string{
					"summary":     "Workflow stuck after a code change",
					"description": "Workflow runHomelabAudit on queue monorepo-workflows failed replay due to a nondeterministic code change. Pause the worker rollout and test replay before shipping a fix.",
				},
			},
		},
	}
}

func multiData() Data {
	return Data{
		Receiver: "postal-fallback",
		Status:   "firing",
		CommonLabels: map[string]string{
			"alert_dashboard_fallback": "true",
		},
		Alerts: Alerts{
			{
				Status: "firing",
				Labels: map[string]string{
					"alertname": "TemporalWorkflowNondeterministic",
					"severity":  "critical",
					"namespace": "temporal",
					"pod":       "temporal-worker-7b9d8f-abc12",
					"node":      "torvalds",
				},
				Annotations: map[string]string{
					"summary":     "Workflow stuck after a code change",
					"description": "A workflow failed replay due to a nondeterministic code change. Pause the worker rollout and test replay before shipping a fix.",
				},
			},
			{
				Status: "firing",
				Labels: map[string]string{
					"alertname":             "PersistentVolumeFillingUp",
					"severity":              "warning",
					"namespace":             "ci",
					"persistentvolumeclaim": "woodpecker-cache-pvc",
				},
				Annotations: map[string]string{
					"summary":     "CI cache disk is 83% full",
					"description": "The Woodpecker CI cache volume will fill up in about 9 days.",
				},
			},
			{
				Status: "firing",
				Labels: map[string]string{
					"alertname":  "ZfsPoolDegraded",
					"severity":   "warning",
					"node":       "liskov",
					"zpool_name": "tank",
				},
				Annotations: map[string]string{
					"summary": "ZFS pool tank is degraded",
				},
			},
		},
	}
}

func main() {
	tmplBytes, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	data := singleData()
	if len(os.Args) > 2 && os.Args[2] == "multi" {
		data = multiData()
	}

	// Alertmanager provides stringSlice in its template functions.
	funcs := map[string]any{
		"stringSlice": func(s ...string) []string { return s },
	}
	tt, err := texttemplate.New("ops").Funcs(funcs).Parse(string(tmplBytes))
	if err != nil {
		panic(err)
	}
	ht, err := htmltemplate.New("ops").Funcs(funcs).Parse(string(tmplBytes))
	if err != nil {
		panic(err)
	}

	var subjBuf, textBuf, htmlBuf bytes.Buffer
	if err := tt.ExecuteTemplate(&subjBuf, "ops.email.subject", data); err != nil {
		panic(err)
	}
	if err := tt.ExecuteTemplate(&textBuf, "ops.email.text", data); err != nil {
		panic(err)
	}
	if err := ht.ExecuteTemplate(&htmlBuf, "ops.email.html", data); err != nil {
		panic(err)
	}

	out, err := json.Marshal(map[string]string{
		"subject": subjBuf.String(),
		"text":    textBuf.String(),
		"html":    htmlBuf.String(),
	})
	if err != nil {
		panic(err)
	}
	_, _ = os.Stdout.Write(out)
}
