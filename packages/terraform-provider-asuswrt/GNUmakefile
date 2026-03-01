default: build

build:
	go build -o terraform-provider-asuswrt

test:
	go test ./... -v

testacc:
	TF_ACC=1 go test ./internal/provider/... -v -timeout 120m

lint:
	golangci-lint run ./...

lint-fix:
	golangci-lint run --fix ./...

fmt:
	gofumpt -w .
	goimports -w -local github.com/shepherdjerred/terraform-provider-asuswrt .

install: build
	mkdir -p ~/.terraform.d/plugins/registry.opentofu.org/shepherdjerred/asuswrt/0.1.0/$$(go env GOOS)_$$(go env GOARCH)
	cp terraform-provider-asuswrt ~/.terraform.d/plugins/registry.opentofu.org/shepherdjerred/asuswrt/0.1.0/$$(go env GOOS)_$$(go env GOARCH)/

clean:
	rm -f terraform-provider-asuswrt

.PHONY: default build test testacc lint lint-fix fmt install clean
