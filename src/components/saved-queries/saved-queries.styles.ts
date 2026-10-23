import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getSavedQueriesStyles = (theme: GrafanaTheme2) => ({
    drawerBody: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(2), minWidth: 0 }),
    listSummary: css({
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: theme.spacing(1),
        color: theme.colors.text.secondary,
        fontSize: theme.typography.bodySmall.fontSize,
    }),
    list: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), listStyle: 'none', padding: 0, margin: 0 }),
    card: css({ marginBottom: 0, minWidth: 0, gridTemplateColumns: 'auto minmax(0, 1fr) auto' }),
    heading: css({ minWidth: 0, overflowWrap: 'anywhere' }),
    tags: css({ alignSelf: 'start' }),
    actions: css({ position: 'relative', zIndex: 1 }),
    description: css({ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }),
    metadata: css({ flexWrap: 'wrap', minWidth: 0 }),
    empty: css({ '> div': { minWidth: 0, marginBottom: 0 } }),
    modal: css({ width: 560, maxWidth: `calc(100vw - ${theme.spacing(4)})` }),
});
