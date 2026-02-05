import React, { ChangeEvent, useState, useEffect } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta, toDataFrame } from '@grafana/data';
import { getBackendSrv, DataSourcePicker } from '@grafana/runtime';
import { Button, Field, FieldSet, Input, SecretInput, useStyles2, Select } from '@grafana/ui';
import { useAtom } from 'jotai';
import { Subscription } from 'rxjs';
import { getDatabases, getTablesService } from 'services/metaservice';
import { testIds } from '../testIds';
import { settingDatabasesAtom, settingTablesAtom } from 'store/discover';

type LogsConfig = {
  datasource?: any;
  database?: string;
  logsTable?: string;
  targetTraceTable?: string;
}

export type AppPluginSettings = {
  apiUrl?: string;
  logsConfig?: LogsConfig
};

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
  const logsConfig = jsonData?.logsConfig || {};

  const [currentLogsConfig, setCurrentLogsConfig] = useState<LogsConfig>(logsConfig);
  const [databases, setDatabases] = useAtom(settingDatabasesAtom);
  const [tables, setTables] = useAtom(settingTablesAtom);

  const isSubmitDisabled = Boolean(!state.apiUrl || (!state.isApiKeySet && !state.apiKey));

  const fetchDatabases = React.useCallback((ds: any) => {
    if (!ds) {
      return undefined;
    }

    return getDatabases(ds).subscribe({
      next: (resp: any) => {
        const { data, ok } = resp;
        if (ok) {
          const frame = toDataFrame(data.results.getDatabases.frames[0]);
          const values = Array.from(frame.fields[0].values);
          const options = values.map((item: string) => ({ label: item, value: item }));
          setDatabases(options);
        }
      },
      error: (err: any) => console.log('Fetch Error', err),
    });
  }, [setDatabases]);

  const fetchTables = React.useCallback((db: string) => {
    if (!db) {
      return undefined;
    }
    return getTablesService({
      selectdbDS: currentLogsConfig.datasource,
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
      error: (err: any) => console.log('Fetch Error', err),
    });
  }, [setTables,currentLogsConfig.datasource])

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
        apiUrl: state.apiUrl,
        logsConfig: { ...currentLogsConfig }
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
          <div className={s.marginTop}>
            <Button type='submit'>
              Save Logs settings
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
});

const updatePluginAndReload = async (pluginId: string, data: Partial<PluginMeta<AppPluginSettings>>) => {
  try {
    await updatePlugin(pluginId, data);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
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
