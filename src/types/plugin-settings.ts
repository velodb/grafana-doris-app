export type LogsConfig = {
  datasource?: any;
  database?: string;
  logsTable?: string;
  targetTraceTable?: string;
};

export type AppPluginSettings = {
  apiUrl?: string;
  logsConfig?: LogsConfig;
};

export const DEFAULT_LOGS_CONFIG: LogsConfig = {
  datasource: 'doris',
  database: 'otel',
  logsTable: 'otel_logs',
  targetTraceTable: 'otel_traces',
};

export function mergeLogsConfig(logsConfig?: LogsConfig): LogsConfig {
  return {
    ...DEFAULT_LOGS_CONFIG,
    ...(logsConfig ?? {}),
  };
}
