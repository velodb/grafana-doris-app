import { t } from 'i18n';
import React, { useEffect } from 'react';
import { locationService } from '@grafana/runtime';
import { LoadingPlaceholder } from '@grafana/ui';

export default function PageDashboard() {
  useEffect(() => {
    locationService.push('/dashboards');
  }, []);

  return <LoadingPlaceholder text={t('Redirecting to Dashboards...')} />;
}

