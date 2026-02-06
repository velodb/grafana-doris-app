FROM alpine:3.19

RUN mkdir -p /assets/plugins

COPY resouece/dashboards/ /assets/dashboards/
COPY resource/doris-app/ /assets/plugins/doris-app/

# Metadata
LABEL org.opencontainers.image.title="DOGStack Grafana Assets"
LABEL org.opencontainers.image.description="Doris App Plugin and Dashboards for Grafana"
LABEL org.opencontainers.image.version=""

CMD ["sh", "-c", "cp -r /assets/plugins/* /target/plugins/ && cp -r /assets/dashboards/* /target/dashboards/ && echo 'Assets copied successfully'"]