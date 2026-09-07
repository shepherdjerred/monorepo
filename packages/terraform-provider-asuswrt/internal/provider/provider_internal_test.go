package provider

import "testing"

func TestInsecureTLSAllowed(t *testing.T) {
	t.Parallel()

	tests := map[string]struct {
		https    bool
		insecure bool
		allowed  bool
	}{
		"HTTP without insecure TLS":  {https: false, insecure: false, allowed: true},
		"HTTPS without insecure TLS": {https: true, insecure: false, allowed: true},
		"HTTPS with insecure TLS":    {https: true, insecure: true, allowed: true},
		"HTTP with insecure TLS":     {https: false, insecure: true, allowed: false},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got := insecureTLSAllowed(test.https, test.insecure); got != test.allowed {
				t.Errorf("insecureTLSAllowed(%t, %t) = %t, want %t", test.https, test.insecure, got, test.allowed)
			}
		})
	}
}
