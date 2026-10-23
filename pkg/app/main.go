package main

import (
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/velodb/grafana-doris-app/pkg/savedqueries"
)

func main() {
	app := savedqueries.New()
	defer app.Close()
	backend.Serve(backend.ServeOpts{CallResourceHandler: app})
}
