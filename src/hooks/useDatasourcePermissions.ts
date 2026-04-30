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
