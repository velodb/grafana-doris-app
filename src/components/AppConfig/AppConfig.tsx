import React, { ChangeEvent, useState, useEffect } from 'react';
import { lastValueFrom, Subscription } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta, SelectableValue, toDataFrame } from '@grafana/data';
import { getBackendSrv, DataSourcePicker, getDataSourceSrv, logError } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, SecretInput, useStyles2, Select, MultiSelect } from '@grafana/ui';
import { useAtom } from 'jotai';
import { getDatabases, getTablesService } from 'services/metaservice';
import { testIds } from '../testIds';
import { settingDatabasesAtom, settingTablesAtom } from 'store/discover';
import {
  DEFAULT_LOGS_CONFIG,
  mergeLogsConfig,
  type AppPluginSettings,
  type LogsConfig,
  type TeamDatasourcePermission,
} from 'types/plugin-settings';
import { toError } from 'utils/errors';
import { fetchTeams, getMysqlDatasources, GrafanaTeam } from 'services/grafana-permissions';

export type { AppPluginSettings, LogsConfig };
export { DEFAULT_LOGS_CONFIG, mergeLogsConfig };

type State = {
  // The URL to reach our custom API.
  apiUrl: string;
  // Tells us if the API key secret is set.
  isApiKeySet: boolean;
  // A secret key for our custom API.
  apiKey: string;
};

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppPluginSettings>> { }

const AppConfig = ({ plugin }: AppConfigProps) => {
  const s = useStyles2(getStyles);
  const { enabled, pinned, jsonData, secureJsonFields } = plugin.meta;
  const [state, setState] = useState<State>({
    apiUrl: jsonData?.apiUrl || '',
    apiKey: '',
    isApiKeySet: Boolean(secureJsonFields?.apiKey),
  });
  const logsConfig = mergeLogsConfig(jsonData?.logsConfig);

  const [currentLogsConfig, setCurrentLogsConfig] = useState<LogsConfig>(logsConfig);
  const [teamDatasourcePermissions, setTeamDatasourcePermissions] = useState<TeamDatasourcePermission[]>(
    jsonData?.teamDatasourcePermissions ?? [],
  );
  const [teams, setTeams] = useState<GrafanaTeam[]>([]);
  const [databases, setDatabases] = useAtom(settingDatabasesAtom);
  const [tables, setTables] = useAtom(settingTablesAtom);

  const isSubmitDisabled = Boolean(!state.apiUrl || (!state.isApiKeySet && !state.apiKey));
  const resolveDatasource = React.useCallback((ds: any) => {
    if (!ds) {
      return undefined;
    }
    if (typeof ds === 'string') {
      return getDataSourceSrv()
        .getList()
        .find(item => item.uid === ds || item.name === ds);
    }
    return ds;
  }, []);
  const datasourceOptions = React.useMemo<Array<SelectableValue<string>>>(() => {
    try {
      return getMysqlDatasources(getDataSourceSrv().getList()).map(ds => ({
        label: ds.name,
        value: ds.uid,
      }));
    } catch {
      return [];
    }
  }, []);
  const teamOptions = React.useMemo<Array<SelectableValue<number>>>(() => {
    return teams.map(team => ({
      label: team.name,
      value: team.id,
    }));
  }, [teams]);

  const updatePermission = React.useCallback((index: number, patch: Partial<TeamDatasourcePermission>) => {
    setTeamDatasourcePermissions(current =>
      current.map((permission, permissionIndex) =>
        permissionIndex === index
          ? {
            ...permission,
            ...patch,
          }
          : permission,
      ),
    );
  }, []);

  const addPermission = React.useCallback(() => {
    const firstTeam = teams.find(team => !teamDatasourcePermissions.some(permission => permission.teamId === team.id));

    setTeamDatasourcePermissions(current => [
      ...current,
      {
        teamId: firstTeam?.id ?? 0,
        teamName: firstTeam?.name ?? '',
        datasourceUids: [],
      },
    ]);
  }, [teamDatasourcePermissions, teams]);

  const removePermission = React.useCallback((index: number) => {
    setTeamDatasourcePermissions(current => current.filter((_, permissionIndex) => permissionIndex !== index));
  }, []);

  const fetchDatabases = React.useCallback((ds: any) => {
    const datasourceRef = resolveDatasource(ds);
    if (!datasourceRef) {
      return undefined;
    }

    return getDatabases(datasourceRef).subscribe({
      next: (resp: any) => {
        const { data, ok } = resp;
        if (ok) {
          const frame = toDataFrame(data.results.getDatabases.frames[0]);
          const values = Array.from(frame.fields[0].values);
          const options = values.map((item: string) => ({ label: item, value: item }));
          setDatabases(options);
        }
      },
      error: (err: any) => logError(toError(err), { source: 'AppConfig', action: 'fetchDatabases' }),
    });
  }, [setDatabases, resolveDatasource]);

  const fetchTables = React.useCallback((db: string) => {
    const datasourceRef = resolveDatasource(currentLogsConfig.datasource);
    if (!db) {
      return undefined;
    }
    if (!datasourceRef) {
      return undefined;
    }
    return getTablesService({
      selectdbDS: datasourceRef,
      database: db,
    }).subscribe({
      next: (resp: any) => {
        const { data, ok } = resp;
        if (ok) {
          const frame = toDataFrame(data.results.getTables.frames[0]);
          const values = Array.from(frame.fields[0].values);
          const options = values.map((item: string) => ({ label: item, value: item }));
          setTables(options);
        }
      },
      error: (err: any) => logError(toError(err), { source: 'AppConfig', action: 'fetchTables' }),
    });
  }, [setTables, currentLogsConfig.datasource, resolveDatasource])

  const onResetApiKey = () =>
    setState({
      ...state,
      apiKey: '',
      isApiKeySet: false,
    });

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setState({
      ...state,
      [event.target.name]: event.target.value.trim(),
    });
  };

  const onSubmit = () => {
    if (isSubmitDisabled) {
      return;
    }

    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        apiUrl: state.apiUrl,
      },
      // This cannot be queried later by the frontend.
      // We don't want to override it in case it was set previously and left untouched now.
      secureJsonData: state.isApiKeySet
        ? undefined
        : {
          apiKey: state.apiKey,
        },
    });
  };

  const submitLogConfig = () => {
    updatePluginAndReload(plugin.meta.id, {
      enabled,
      pinned,
      jsonData: {
        ...jsonData,
        apiUrl: state.apiUrl,
        logsConfig: { ...currentLogsConfig },
        teamDatasourcePermissions: teamDatasourcePermissions.filter(permission => permission.teamId > 0)
      },
      // This cannot be queried later by the frontend.
      // We don't want to override it in case it was set previously and left untouched now.
      secureJsonData: state.isApiKeySet
        ? undefined
        : {
          apiKey: state.apiKey,
        }
    });
  }

  useEffect(() => {
    void fetchTeams()
      .then(setTeams)
      .catch((err: any) => logError(toError(err), { source: 'AppConfig', action: 'fetchTeams' }));
  }, []);

  useEffect(() => {
    const datasourceRef = resolveDatasource(currentLogsConfig.datasource);
    if (datasourceRef && datasourceRef !== currentLogsConfig.datasource) {
      setCurrentLogsConfig(prev => ({
        ...prev,
        datasource: datasourceRef,
      }));
    }
  }, [currentLogsConfig.datasource, resolveDatasource]);

  useEffect(() => {
    if (!currentLogsConfig.datasource) {
      return;
    }

    const subscription: Subscription | undefined = fetchDatabases(currentLogsConfig.datasource);

    return () => subscription?.unsubscribe();
  }, [currentLogsConfig.datasource, fetchDatabases]);

  useEffect(() => {
    if (!currentLogsConfig.database) {
      return;
    }
    const subscription: Subscription | undefined = fetchTables(currentLogsConfig.database);

    return () => subscription?.unsubscribe(); 
  }, [currentLogsConfig.database, fetchTables])

  return (
    <>
      <form onSubmit={onSubmit}>
        <FieldSet label="API Settings">
          <Field label="API Key" description="A secret key for authenticating to our custom API">
            <SecretInput
              width={60}
              id="config-api-key"
              data-testid={testIds.appConfig.apiKey}
              name="apiKey"
              value={state.apiKey}
              isConfigured={state.isApiKeySet}
              placeholder={'Your secret API key'}
              onChange={onChange}
              onReset={onResetApiKey}
            />
          </Field>

          <Field label="API Url" description="" className={s.marginTop}>
            <Input
              width={60}
              name="apiUrl"
              id="config-api-url"
              data-testid={testIds.appConfig.apiUrl}
              value={state.apiUrl}
              placeholder={`E.g.: http://mywebsite.com/api/v1`}
              onChange={onChange}
            />
          </Field>

          <div className={s.marginTop}>
            <Button type="submit" data-testid={testIds.appConfig.submit} disabled={isSubmitDisabled}>
              Save API settings
            </Button>
          </div>
        </FieldSet>
      </form>
      <form className={s.marginTop} onSubmit={submitLogConfig}>
        <FieldSet>
          <Field label="Default Datasource">
            <DataSourcePicker
              width={20}
              type={'mysql'}
              current={currentLogsConfig.datasource}
              placeholder="Choose"
              noDefault
              filter={ds => ds.type === 'mysql'}
              onChange={item => {
                setCurrentLogsConfig({ ...currentLogsConfig, datasource: item });
                // Always fetch databases even if the same datasource is selected
                fetchDatabases(item);
              }}
            />
          </Field>
          <Field label="Default Database">
            <Select
              width={60}
              options={databases}
              value={currentLogsConfig.database}
              onChange={(selectedDatabase: any) => {
                setCurrentLogsConfig({ ...currentLogsConfig, database: selectedDatabase.value })
                fetchTables(selectedDatabase.value)
              }}
            ></Select>
          </Field>
          <Field label="Default Logs Table">
            <Select
              options={tables}
              width={60}
              value={currentLogsConfig.logsTable}
              onChange={(selectedTable: any) => {
                setCurrentLogsConfig({
                  ...currentLogsConfig,
                  logsTable: selectedTable.value
                })
              }}
            />
          </Field>
          <Field label="Default Trace Table">
            <Select
              options={tables}
              width={60}
              value={currentLogsConfig.targetTraceTable}
              onChange={(selectedTable: any) => {
                setCurrentLogsConfig({
                  ...currentLogsConfig,
                  targetTraceTable: selectedTable.value
                })
              }}
            />
          </Field>
          <Field label="Team Datasource Permissions" description="Users with no teams can view all MySQL datasources. Users in teams can only view datasources configured here.">
            <div>
              {teamDatasourcePermissions.map((permission, index) => {
                const selectedDatasourceOptions = datasourceOptions.filter(option =>
                  permission.datasourceUids.includes(option.value ?? ''),
                );

                return (
                  <div className={s.permissionRow} key={`${permission.teamId}-${index}`}>
                    <Select
                      width={30}
                      options={teamOptions}
                      value={permission.teamId || undefined}
                      placeholder="Choose team"
                      onChange={(selectedTeam: SelectableValue<number>) => {
                        updatePermission(index, {
                          teamId: selectedTeam.value ?? 0,
                          teamName: selectedTeam.label ?? '',
                        });
                      }}
                    />
                    <MultiSelect
                      width={45}
                      options={datasourceOptions}
                      value={selectedDatasourceOptions}
                      placeholder="Choose datasources"
                      onChange={(selectedDatasources: Array<SelectableValue<string>>) => {
                        updatePermission(index, {
                          datasourceUids: selectedDatasources
                            .map(datasource => datasource.value)
                            .filter((uid): uid is string => Boolean(uid)),
                        });
                      }}
                    />
                    <Button type="button" variant="destructive" onClick={() => removePermission(index)}>
                      Remove
                    </Button>
                  </div>
                );
              })}
              <Button type="button" variant="secondary" onClick={addPermission}>
                Add team permission
              </Button>
            </div>
          </Field>
          <div className={s.marginTop}>
            <Button type='submit'>
              Save plugin settings
            </Button>
          </div>
        </FieldSet>
      </form>
    </>

  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  colorWeak: css`
    color: ${theme.colors.text.secondary};
  `,
  marginTop: css`
    margin-top: ${theme.spacing(3)};
  `,
  permissionRow: css`
    display: flex;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(1)};
    align-items: flex-start;
  `,
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    window.location.reload();
  } catch (e) {
    logError(toError(e), { source: 'AppConfig', action: 'updatePluginAndReload' });
  }
};

const updatePlugin = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  return lastValueFrom(response);
};
