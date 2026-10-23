import { css } from '@emotion/css';
import styled from '@emotion/styled';

export const HoverStyle = css`
    &:hover {
        .filter-content {
            visibility: visible;
        }
    }
`;

export const ColumnStyleWrapper = styled.div`
    .field-pair {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        margin: 1px 6px 1px 0;
        max-width: 100%;
    }

    .field-key {
        padding: 0px 4px 2px;
        border-radius: 4px;
        flex-shrink: 0;
        white-space: nowrap;
    }

    .field-value {
        min-width: 0;
    }
`;
