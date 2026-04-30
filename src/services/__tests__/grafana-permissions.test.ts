import { DataSourceInstanceSettings, DataSourceJsonData } from '@grafana/data';
import { filterDatasourcesByTeamPermissions } from '../grafana-permissions';

function datasource(uid: string, type = 'mysql'): DataSourceInstanceSettings<DataSourceJsonData> {
  return {
    uid,
    type,
    name: uid,
  } as DataSourceInstanceSettings<DataSourceJsonData>;
}

describe('filterDatasourcesByTeamPermissions', () => {
  const datasources = [
    datasource('doris-a'),
    datasource('doris-b'),
    datasource('postgres-a', 'postgres'),
  ];

  test('returns all mysql datasources when user has no teams', () => {
    expect(filterDatasourcesByTeamPermissions(datasources, [], [])).toEqual([
      datasource('doris-a'),
      datasource('doris-b'),
    ]);
  });

  test('returns datasource union for matching user teams', () => {
    expect(
      filterDatasourcesByTeamPermissions(
        datasources,
        [
          { id: 1, name: 'observability' },
          { id: 2, name: 'platform' },
        ],
        [
          { teamId: 1, teamName: 'observability', datasourceUids: ['doris-a'] },
          { teamId: 2, teamName: 'platform', datasourceUids: ['doris-b'] },
          { teamId: 3, teamName: 'other', datasourceUids: ['postgres-a'] },
        ],
      ),
    ).toEqual([datasource('doris-a'), datasource('doris-b')]);
  });

  test('returns no datasources when user teams have no permission rule', () => {
    expect(
      filterDatasourcesByTeamPermissions(
        datasources,
        [{ id: 99, name: 'unknown' }],
        [{ teamId: 1, teamName: 'observability', datasourceUids: ['doris-a'] }],
      ),
    ).toEqual([]);
  });

  test('does not return non-mysql datasources even when explicitly allowed', () => {
    expect(
      filterDatasourcesByTeamPermissions(
        datasources,
        [{ id: 1, name: 'observability' }],
        [{ teamId: 1, teamName: 'observability', datasourceUids: ['postgres-a'] }],
      ),
    ).toEqual([]);
  });
});
