import React, { ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { I18nextProvider } from 'react-i18next';
import { pluginI18n } from './index';

export function PluginLocaleProvider({ children }: { children: ReactNode }) {
    return (
        <I18nextProvider i18n={pluginI18n}>
            <ConfigProvider locale={pluginI18n.language === 'zh-CN' ? zhCN : enUS}>{children}</ConfigProvider>
        </I18nextProvider>
    );
}
