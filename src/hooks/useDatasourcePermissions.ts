import React from 'react';
import { DataSourceInstanceSettings, DataSourceJsonData } from '@grafana/data';
import { getDataSourceSrv, logError } from '@grafana/runtime';
import { filterDatasourcesByTeamPermissions, fetchCurrentUserTeams } from 'services/grafana-permissions';
import { TeamDatasourcePermission } from 'types/plugin-settings';
import { toError } from 'utils/errors';

type DatasourcePermissionsState = {
  allowedDatasources: Array<DataSourceInstanceSettings<DataSourceJsonData>>;
  allowedDatasourceUids: Set<string>;
  loading: boolean;
  error?: Error;
};

const EMPTY_PERMISSIONS: TeamDatasourcePermission[] = [];

export function useDatasourcePermissions(
  permissions: TeamDatasourcePermission[] | undefined = EMPTY_PERMISSIONS,
  source: string,
): DatasourcePermissionsState {
  const permissionRules = permissions ?? EMPTY_PERMISSIONS;
  const [state, setState] = React.useState<DatasourcePermissionsState>({
    allowedDatasources: [],
    allowedDatasourceUids: new Set<string>(),
    loading: true,
  });

  React.useEffect(() => {
    let isMounted = true;

    // An empty permission configuration means that no team-level restriction is
    // configured. Do not make the datasource picker depend on the user-teams API
    // in that case: the endpoint may be unavailable behind a reverse proxy or
    // for Grafana deployments that do not use teams at all.
    if (permissionRules.length === 0) {
      const allowedDatasources = filterDatasourcesByTeamPermissions(getDataSourceSrv().getList(), [], EMPTY_PERMISSIONS);
      setState({
        allowedDatasources,
        allowedDatasourceUids: new Set(allowedDatasources.map(ds => ds.uid)),
        loading: false,
      });

      return () => {
        isMounted = false;
      };
    }

    async function loadPermissions() {
      try {
        const teams = await fetchCurrentUserTeams();
        const allowedDatasources = filterDatasourcesByTeamPermissions(
          getDataSourceSrv().getList(),
          teams,
          permissionRules,
        );

        if (!isMounted) {
          return;
        }

        setState({
          allowedDatasources,
          allowedDatasourceUids: new Set(allowedDatasources.map(ds => ds.uid)),
          loading: false,
        });
      } catch (error) {
        const err = toError(error);
        logError(err, { source, action: 'loadDatasourcePermissions' });

        if (!isMounted) {
          return;
        }

        setState({
          allowedDatasources: [],
          allowedDatasourceUids: new Set<string>(),
          loading: false,
          error: err,
        });
      }
    }

    void loadPermissions();

    return () => {
      isMounted = false;
    };
  }, [permissionRules, source]);

  return state;
}
