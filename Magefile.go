//go:build mage

package main

import (
	"os"
	"os/exec"
	"runtime"

	"github.com/magefile/mage/sh"
)

// Build compiles the Grafana backend where Grafana discovers the nested datasource.
func Build() error {
	if err := os.MkdirAll("dist/datasource", 0o755); err != nil {
		return err
	}
	if err := sh.RunV("go", "mod", "vendor"); err != nil {
		return err
	}
	if err := sh.RunV("git", "apply", "--directory=vendor/github.com/go-sql-driver/mysql", "internal/mysqloidc/authentication_openid_connect_client.patch"); err != nil {
		return err
	}
	return buildFor(runtime.GOOS, runtime.GOARCH)
}

// BuildAll creates the Linux binaries Grafana uses in containers plus the
// current host binary for local development.
func BuildAll() error {
	if err := Build(); err != nil {
		return err
	}
	for _, target := range [][2]string{{"linux", "amd64"}, {"linux", "arm64"}} {
		if target[0] == runtime.GOOS && target[1] == runtime.GOARCH {
			continue
		}
		if err := buildFor(target[0], target[1]); err != nil {
			return err
		}
	}
	return nil
}

func buildFor(goos, goarch string) error {
	name := "dist/datasource/velodb-doris-datasource_" + goos + "_" + goarch
	cmd := exec.Command("go", "build", "-mod=vendor", "-o", name, "./pkg")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+goos, "GOARCH="+goarch)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

// Test runs all Go backend tests.
func Test() error { return sh.RunV("go", "test", "./pkg/...") }
