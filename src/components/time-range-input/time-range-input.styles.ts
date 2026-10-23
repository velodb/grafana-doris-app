import { css } from '@emotion/css';

export const timeRangeFieldClass = css`
    /* Grafana's time popup uses a transformed floating container. A nested,
       non-portaled Select must use local coordinates instead of viewport ones. */
    #TimePickerContent div:has(> div > [role='listbox']) {
        position: absolute;
        inset: 100% 0 auto;
        width: 100%;
    }
`;
