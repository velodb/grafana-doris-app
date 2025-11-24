import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import { ROUTES } from '../../constants';
const Discover = React.lazy(() => import('../../pages/PageDiscover'));
const PageTrace = React.lazy(() => import('../../pages/PageTrace'));
// const PageDashboard = React.lazy(() => import('../../pages/PageDashboard'));

function App(_props: AppRootProps) {
    return (
        <Routes>
            <Route path={ROUTES.Discover} element={<Discover />} />
            <Route path={`${ROUTES.Traces}`} element={<PageTrace />} />
            {/* <Route path={`${ROUTES.Dashboard}`} element={<PageDashboard />} /> */}
            <Route path="*" element={<Discover />} />
        </Routes>
    );
}

export default App;
