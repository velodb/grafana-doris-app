import React, { useContext } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { useTranslation } from 'react-i18next';
import { PluginLocaleProvider } from './PluginLocaleProvider';
import { withPluginLocale } from './withPluginLocale';
import { pluginI18n } from './index';

function LocaleProbe() {
    const { t } = useTranslation();
    const { locale } = useContext(ConfigProvider.ConfigContext);
    return (
        <div>
            <span>{t('Save')}</span>
            <span>{locale?.locale}</span>
        </div>
    );
}

afterEach(async () => {
    cleanup();
    await pluginI18n.changeLanguage('en-US');
});

it.each([
    ['en-US', 'Save', 'en'],
    ['zh-CN', '保存', 'zh-cn'],
])('provides the same %s locale to React and Ant Design', async (language, save, antdLocale) => {
    await pluginI18n.changeLanguage(language);
    render(
        <PluginLocaleProvider>
            <LocaleProbe />
        </PluginLocaleProvider>,
    );
    expect(screen.getByText(save)).toBeInTheDocument();
    expect(screen.getByText(antdLocale)).toBeInTheDocument();
});

it('supports a standalone editor entry without an application root', async () => {
    await pluginI18n.changeLanguage('zh-CN');
    const Editor = withPluginLocale(LocaleProbe);
    render(<Editor />);
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('zh-cn')).toBeInTheDocument();
});
