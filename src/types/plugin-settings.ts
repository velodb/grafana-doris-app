export type TeamDatasourcePermission = {
  teamId: number;
  teamName: string;
  datasourceUids: string[];
};

export type LogsConfig = {
  datasource?: any;
  database?: string;
  logsTable?: string;
  targetTraceTable?: string;
  applicationAttributeKey?: string;
};

export type AppPluginSettings = {
  apiUrl?: string;
  logsConfig?: LogsConfig;
  teamDatasourcePermissions?: TeamDatasourcePermission[];
};

export const DEFAULT_LOGS_CONFIG: LogsConfig = {
  datasource: 'doris',
  database: 'otel',
  logsTable: 'otel_logs',
  targetTraceTable: 'otel_traces',
  applicationAttributeKey: 'app',
};

export function normalizeApplicationAttributeKey(value?: string): string {
  return value?.trim() || DEFAULT_LOGS_CONFIG.applicationAttributeKey || 'app';
}

export function mergeLogsConfig(logsConfig?: LogsConfig): LogsConfig {
  return {
    ...DEFAULT_LOGS_CONFIG,
    ...(logsConfig ?? {}),
    applicationAttributeKey: normalizeApplicationAttributeKey(logsConfig?.applicationAttributeKey),
  };
}
