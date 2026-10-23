package main

import (
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/velodb/grafana-doris-app/pkg/plugin"
)

func main() {
	datasource := plugin.NewDatasource()
	backend.Serve(backend.ServeOpts{
		QueryDataHandler:    datasource,
		CheckHealthHandler:  datasource,
		CallResourceHandler: datasource,
	})
}
