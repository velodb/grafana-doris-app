import React, { useEffect } from 'react';
import { locationService } from '@grafana/runtime';
import { LoadingPlaceholder } from '@grafana/ui';

export default function PageDashboard() {
  useEffect(() => {
    locationService.push('/dashboards');
  }, []);

  return <LoadingPlaceholder text="Redirecting to Dashboards..." />;
}

