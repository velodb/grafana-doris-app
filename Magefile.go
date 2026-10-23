//go:build mage

package main

import (
	"os"
	"os/exec"
	"runtime"

	"github.com/magefile/mage/sh"
)

// Build compiles both the App backend and the nested Doris datasource backend.
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
	for _, target := range []struct{ path, name, source string }{
		{"dist/datasource/", "velodb-doris-datasource", "./pkg"},
		{"dist/", "velodb-doris-app", "./pkg/app"},
	} {
		name := target.path + target.name + "_" + goos + "_" + goarch
		if goos == "windows" {
			name += ".exe"
		}
		cmd := exec.Command("go", "build", "-mod=vendor", "-o", name, target.source)
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS="+goos, "GOARCH="+goarch)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return err
		}
	}
	return nil
}

// Test runs all Go backend tests.
func Test() error { return sh.RunV("go", "test", "./pkg/...") }
