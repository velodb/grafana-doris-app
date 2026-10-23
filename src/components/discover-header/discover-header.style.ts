import { css } from '@emotion/css';
import styled from '@emotion/styled';
import { Field } from '@grafana/ui';

export const DiscoverHeaderField = styled(Field)`
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    min-width: 0;
    max-width: 100%;

    /* Grafana 10 renders a label directly; newer versions wrap it in a div. */
    > label,
    > div:first-child:not(:last-child) {
        margin: 0;
        flex: 0 0 auto;
        white-space: nowrap;
    }

    > div:last-child {
        flex: 1;
        min-width: 0;
    }
`;

export const DiscoverHeaderActions = styled.div`
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    margin-left: auto;
`;

export const DiscoverHeaderControls = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;

    > div {
        margin-bottom: 0;
    }
`;

export const DiscoverHeaderSearch = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;

    > div {
        margin-bottom: 0;
    }
    .ant-select-open {
        .ant-select-arrow {
            .anticon {
                transform: rotate(-180deg);
            }
        }
    }
    .select-database {
        width: 160px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    .ant-select-single {
        height: 30px;
    }
`;

export const DiscoverHeaderTimeSelect = styled.div`
    flex: 1;
    display: flex;
    border-radius: 6px;
    align-items: center;
    margin-right: 8px;

    div.trp-time-label {
        border: 0px;
    }
`;

export const CascaderStyle = css`
    width: 184px;
    .ant-select-selector {
        padding: 0 16px 0 40px !important;
    }
    .ant-select-selection-placeholder,
    .ant-select-selection-item {
        margin-top: 2px;
    }
    .ant-select-selector > .ant-select-selection-search > .ant-select-selection-search-input {
        margin-left: 1.8rem;
    }
`;
