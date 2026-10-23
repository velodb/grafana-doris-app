import React, { ComponentType } from 'react';
import { PluginLocaleProvider } from './PluginLocaleProvider';

export function withPluginLocale<P extends object>(Component: ComponentType<P>): ComponentType<P> {
    const Localized = (props: P) => (
        <PluginLocaleProvider>
            <Component {...props} />
        </PluginLocaleProvider>
    );
    Localized.displayName = `withPluginLocale(${Component.displayName || Component.name || 'Component'})`;
    return Localized;
}
