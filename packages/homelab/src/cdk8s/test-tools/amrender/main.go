// Command amrender renders Alertmanager Go templates against fixture data using
// the same text/template engine Alertmanager uses, so tests can assert on the
// EXACT string Alertmanager would send to PagerDuty (incident title, custom
// details, severity) rather than merely grepping the template source.
//
// It reads a JSON job list from stdin and writes a JSON result list to stdout:
//
//	{"jobs":[{"id":"...","template":"{{ ... }}","data":{...}}]}
//	-> {"results":[{"id":"...","output":"...","error":""}]}
//
// The `data` object mirrors the subset of Alertmanager's template.Data contract
// that the PagerDuty receiver templates use: CommonLabels, CommonAnnotations,
// GroupLabels (maps), Alerts (each with Status/Labels/Annotations, exposing the
// Firing/Resolved methods), and ExternalURL. The templates in scope use only Go
// text/template builtins (if/else/range/eq/gt/len/index), so stdlib rendering is
// faithful; if a template later adds an Alertmanager-specific function, swap this
// for github.com/prometheus/alertmanager/template.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/template"
)

type kv map[string]string

type alert struct {
	Status      string `json:"status"`
	Labels      kv     `json:"labels"`
	Annotations kv     `json:"annotations"`
}

type alerts []alert

func (as alerts) Firing() alerts   { return as.filter("firing") }
func (as alerts) Resolved() alerts { return as.filter("resolved") }

func (as alerts) filter(status string) alerts {
	out := alerts{}
	for _, a := range as {
		if a.Status == status {
			out = append(out, a)
		}
	}
	return out
}

// data mirrors prometheus/alertmanager/template.Data (subset used by the
// PagerDuty receiver templates).
type data struct {
	Receiver          string `json:"receiver"`
	Status            string `json:"status"`
	Alerts            alerts `json:"alerts"`
	GroupLabels       kv     `json:"groupLabels"`
	CommonLabels      kv     `json:"commonLabels"`
	CommonAnnotations kv     `json:"commonAnnotations"`
	ExternalURL       string `json:"externalURL"`
}

type job struct {
	ID       string `json:"id"`
	Template string `json:"template"`
	Data     data   `json:"data"`
}

type result struct {
	ID     string `json:"id"`
	Output string `json:"output"`
	Error  string `json:"error"`
}

func render(j job) result {
	r := result{ID: j.ID}
	t, err := template.New(j.ID).Option("missingkey=zero").Parse(j.Template)
	if err != nil {
		r.Error = "parse: " + err.Error()
		return r
	}
	var b strings.Builder
	if err := t.Execute(&b, j.Data); err != nil {
		r.Error = "execute: " + err.Error()
		return r
	}
	r.Output = b.String()
	return r
}

func main() {
	var in struct {
		Jobs []job `json:"jobs"`
	}
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		fmt.Fprintln(os.Stderr, "amrender: failed to decode stdin:", err)
		os.Exit(1)
	}
	out := struct {
		Results []result `json:"results"`
	}{Results: make([]result, 0, len(in.Jobs))}
	for _, j := range in.Jobs {
		out.Results = append(out.Results, render(j))
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, "amrender: failed to encode stdout:", err)
		os.Exit(1)
	}
}
