import { DataQuery, DataSourceJsonData } from '@grafana/data';

export interface DorisQuery extends DataQuery {
    rawSql: string;
    format?: 'table' | 'time_series';
    describeExtendVariantColumn?: boolean;
}

export interface GroupRoleMapping {
    oidcGroup?: string;
    // Read old saved mappings during migration; new configurations use oidcGroup.
    keycloakGroup?: string;
    dorisRole: string;
}

export interface DorisSSOJsonData extends DataSourceJsonData {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    enableSso?: boolean;
    tlsEnabled?: boolean;
    tlsServerName?: string;
    tlsSkipVerify?: boolean;
    providerMode?: 'oidcDiscovery' | 'keyrock';
    oidcIssuer?: string;
    oidcAudience?: string;
    oidcBackchannelUrl?: string;
    keyrockBaseUrl?: string;
    keyrockClientId?: string;
    allowInsecureIdp?: boolean;
    localDevelopment?: boolean;
    // Legacy fields are read by the backend for provisioned datasource migration.
    keyrockIssuer?: string;
    keyrockJwksUrl?: string;
    keyrockAudience?: string;
    dorisRole?: string;
    groupRoleMappings?: GroupRoleMapping[];
    oauthPassThru?: boolean;
}
