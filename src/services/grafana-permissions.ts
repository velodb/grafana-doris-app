import { DataSourceInstanceSettings, DataSourceJsonData } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { TeamDatasourcePermission } from 'types/plugin-settings';

export type GrafanaTeam = {
  id: number;
  name: string;
};

export const DORIS_DATASOURCE_TYPE = 'velodb-doris-datasource';
export const MYSQL_DATASOURCE_TYPE = 'mysql';
export const SUPPORTED_DATASOURCE_TYPES = [DORIS_DATASOURCE_TYPE, MYSQL_DATASOURCE_TYPE];

type TeamSearchResponse = {
  teams?: GrafanaTeam[];
};

export async function fetchCurrentUserTeams(): Promise<GrafanaTeam[]> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<GrafanaTeam[]>({
      url: '/api/user/teams',
      method: 'GET',
    }),
  );

  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchTeams(): Promise<GrafanaTeam[]> {
  const response = await lastValueFrom(
    getBackendSrv().fetch<TeamSearchResponse>({
      url: '/api/teams/search?perpage=100&page=1',
      method: 'GET',
    }),
  );

  return Array.isArray(response.data?.teams) ? response.data.teams : [];
}

export function isSupportedDatasourceType(type?: string): boolean {
  return type !== undefined && SUPPORTED_DATASOURCE_TYPES.includes(type);
}

export function getMysqlDatasources(
  datasources: Array<DataSourceInstanceSettings<DataSourceJsonData>>,
): Array<DataSourceInstanceSettings<DataSourceJsonData>> {
  return datasources.filter(ds => isSupportedDatasourceType(ds.type));
}

export function filterDatasourcesByTeamPermissions(
  datasources: Array<DataSourceInstanceSettings<DataSourceJsonData>>,
  teams: GrafanaTeam[],
  permissions: TeamDatasourcePermission[] = [],
): Array<DataSourceInstanceSettings<DataSourceJsonData>> {
  const mysqlDatasources = getMysqlDatasources(datasources);

  if (teams.length === 0) {
    return mysqlDatasources;
  }

  const teamIds = new Set(teams.map(team => team.id));
  const allowedDatasourceUids = new Set<string>();

  permissions.forEach(permission => {
    if (!teamIds.has(permission.teamId)) {
      return;
    }

    permission.datasourceUids.forEach(uid => {
      if (uid) {
        allowedDatasourceUids.add(uid);
      }
    });
  });

  return mysqlDatasources.filter(ds => allowedDatasourceUids.has(ds.uid));
}
