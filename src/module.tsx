import { t } from './i18n';
import { PluginLocaleProvider } from './i18n/PluginLocaleProvider';
import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import type { AppConfigProps } from './components/AppConfig/AppConfig';
const LazyApp = lazy(() => import('./components/App/App'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
import dayjs from 'dayjs';
import localeData from 'dayjs/plugin/localeData';
import weekday from 'dayjs/plugin/weekday';
import utc from 'dayjs/plugin/utc';

declare let __webpack_public_path__: string;

dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(utc);

function ensureTailwindStylesheet() {
  if (typeof document === 'undefined') {
    return;
  }

  const stylesheetId = 'velodb-doris-app-tailwind';
  if (document.getElementById(stylesheetId)) {
    return;
  }

  const link = document.createElement('link');
  link.id = stylesheetId;
  link.rel = 'stylesheet';
  link.href = `${__webpack_public_path__}static/tailwind.css`;
  document.head.appendChild(link);
}

ensureTailwindStylesheet();

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <PluginLocaleProvider><LazyApp {...props} /></PluginLocaleProvider>
  </Suspense>
);

const AppConfig = (props: AppConfigProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <PluginLocaleProvider><LazyAppConfig {...props} /></PluginLocaleProvider>
  </Suspense>
);

export const plugin = new AppPlugin<{}>().setRootPage(App).addConfigPage({
  title: t('Configuration'),
  icon: 'cog',
  body: AppConfig,
  id: 'configuration',
});
