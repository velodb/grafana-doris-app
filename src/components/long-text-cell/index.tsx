import { t } from 'i18n';
import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { Button, ClipboardButton, Toggletip, useTheme2 } from '@grafana/ui';

interface LongTextCellProps {
    children: ReactNode;
    copyText: string;
    className?: string;
    /** Zero fits all content; undefined leaves sizing to the caller. */
    maxLines?: number;
}

export function LongTextCell({ children, copyText, className, maxLines }: LongTextCellProps) {
    const theme = useTheme2();
    const contentRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    // Wrapping can make a lengthy value fit without making it easy to copy.
    const canCopy = isOverflowing || copyText.length > 120;

    const updateOverflow = useCallback(() => {
        const element = contentRef.current;
        if (!element) {
            return;
        }
        setIsOverflowing(current => {
            const overflows = (node: HTMLElement) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight;
            // Selected fields can be ellipsized by a nested span while the
            // outer content container itself still fits.
            const next = overflows(element) || Array.from(element.querySelectorAll<HTMLElement>('*')).some(overflows);
            return current === next ? current : next;
        });
    }, []);

    useEffect(() => {
        setCopyFailed(false);
        setPreviewOpen(false);
    }, [copyText]);

    useEffect(() => {
        if (!canCopy) {
            setPreviewOpen(false);
        }
    }, [canCopy]);

    useEffect(() => {
        updateOverflow();
        const element = contentRef.current;
        if (!element || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(element);
        return () => observer.disconnect();
    }, [updateOverflow, copyText, maxLines]);

    const preview = (
        <div
            role="dialog"
            aria-label={t('Full cell content')}
            className={css`
                width: min(560px, calc(100vw - 64px));
                box-sizing: border-box;
            `}
        >
            <div
                tabIndex={0}
                aria-label={t('Cell value')}
                className={css`
                    max-height: min(400px, 60vh);
                    overflow: auto;
                    white-space: pre-wrap;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                `}
            >
                {copyText}
            </div>
            <ClipboardButton
                type="button"
                aria-label={t('Copy full cell content')}
                variant="secondary"
                size="sm"
                icon="copy"
                getText={() => copyText}
                onClipboardCopy={() => setCopyFailed(false)}
                onClipboardError={() => setCopyFailed(true)}
                className={css`
                    margin-top: 12px;
                `}
            >
                {t('Copy full cell content')}
            </ClipboardButton>
            {copyFailed && (
                <span role="alert" style={{ color: theme.colors.error.text }}>
                    {t('Copy failed')}
                </span>
            )}
        </div>
    );

    return (
        <div
            data-testid="long-text-cell-container"
            onMouseEnter={updateOverflow}
            onFocusCapture={updateOverflow}
            className={css`
                position: relative;
                min-width: 0;
                width: 100%;
                flex: 1 1 0;

                &:hover > .cell-copy-action,
                td:hover & > .cell-copy-action,
                &:focus-within > .cell-copy-action {
                    opacity: 1;
                    pointer-events: auto;
                }
            `}
        >
            <div
                ref={contentRef}
                className={cx(
                    className,
                    maxLines !== undefined &&
                        css`
                            display: ${maxLines > 0 ? '-webkit-box' : 'block'};
                            -webkit-box-orient: vertical;
                            ${maxLines > 0 ? `-webkit-line-clamp: ${maxLines};` : ''}
                            max-height: none;
                            overflow: ${maxLines > 0 ? 'hidden' : 'visible'};
                            white-space: pre-wrap;
                            overflow-wrap: anywhere;
                            word-break: break-word;
                            line-height: 20px;
                        `,
                )}
                data-testid="long-text-cell"
                onMouseEnter={updateOverflow}
            >
                {children}
            </div>
            {canCopy && (
                <div
                    className={`cell-copy-action ${css`
                        position: absolute;
                        top: 2px;
                        right: 2px;
                        z-index: 1;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        opacity: 0;
                        pointer-events: none;
                        border-radius: ${theme.shape.radius.default};
                        background: ${theme.colors.background.primary};

                        @media (hover: none) {
                            opacity: 1;
                            pointer-events: auto;
                        }
                    `}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                    onDoubleClick={event => event.stopPropagation()}
                >
                    {copyFailed && !previewOpen && (
                        <span role="alert" style={{ color: theme.colors.error.text, padding: '0 4px', fontSize: theme.typography.bodySmall.fontSize }}>
                            {t('Copy failed')}
                        </span>
                    )}
                    <Toggletip
                        title={t('Full content')}
                        content={preview}
                        placement="bottom-start"
                        show={previewOpen}
                        onOpen={() => setPreviewOpen(true)}
                        onClose={() => setPreviewOpen(false)}
                        fitContent
                    >
                        <Button
                            type="button"
                            aria-label={t('View full cell content')}
                            aria-expanded={previewOpen}
                            aria-haspopup="dialog"
                            title={t('View full cell content')}
                            variant="secondary"
                            size="sm"
                            icon="eye"
                        />
                    </Toggletip>
                    <ClipboardButton
                        type="button"
                        aria-label={t('Copy full cell content')}
                        title={t('Copy full cell content')}
                        variant="secondary"
                        size="sm"
                        icon="copy"
                        getText={() => copyText}
                        onClipboardCopy={() => setCopyFailed(false)}
                        onClipboardError={() => setCopyFailed(true)}
                    />
                </div>
            )}
        </div>
    );
}
