1. 下载并解压 https://github.com/velodb/grafana-doris-app/releases/tag  的最新版本 doris-app.zip，解压 放置到 Resource 目录
2. 在https://github.com/velodb/open-observability-stack/images/doris-plugin/dashboards 获取 最新版本的 dashboard json 文件，放置到 Resource 目录
3. 运行docker build 命令构建镜像，示例：

   ```bash
   docker build -t velodb/grafana-doris-app:latest .
   ```
