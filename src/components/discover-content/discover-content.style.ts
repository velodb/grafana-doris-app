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
    .field-key {
        padding: 0px 4px 2px;
        margin-right: 4px;
        border-radius: 4px;
    }
`;
