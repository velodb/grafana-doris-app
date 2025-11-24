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
import '../styles/tailwind.css';

dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(utc);
import 'dayjs/locale/zh-cn';
const browserLang = navigator.language.toLowerCase(); // e.g., 'zh-cn', 'en-us'
const supportedLocales = ['en', 'zh-cn', 'fr'];

const locale = supportedLocales.includes(browserLang) ? browserLang : 'en';
dayjs.locale(locale);

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

const AppConfig = (props: AppConfigProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyAppConfig {...props} />
  </Suspense>
);

export const plugin = new AppPlugin<{}>().setRootPage(App).addConfigPage({
  title: 'Configuration',
  icon: 'cog',
  body: AppConfig,
  id: 'configuration',
});

