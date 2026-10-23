import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LongTextCell } from './index';

function setOverflow(element: HTMLElement, { width = false, height = false } = {}) {
    Object.defineProperties(element, {
        clientWidth: { configurable: true, value: 100 },
        scrollWidth: { configurable: true, value: width ? 101 : 100 },
        clientHeight: { configurable: true, value: 20 },
        scrollHeight: { configurable: true, value: height ? 21 : 20 },
    });
}

describe('LongTextCell', () => {
    beforeEach(() => {
        // Grafana ClipboardButton uses navigator.clipboard only on HTTPS.
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    });
    it('does not expose a preview or copy action when the cell fits', () => {
        render(<LongTextCell copyText="short">short</LongTextCell>);
        const cell = screen.getByTestId('long-text-cell');
        setOverflow(cell);
        fireEvent.mouseEnter(cell);

        expect(screen.queryByRole('button', { name: 'Copy full cell content' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'View full cell content' })).not.toBeInTheDocument();
    });

    it('shows the complete value and copies it when the cell is truncated', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<LongTextCell copyText="the complete value">truncated…</LongTextCell>);
        const cell = screen.getByTestId('long-text-cell');
        setOverflow(cell, { height: true });
        fireEvent.mouseEnter(cell);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'View full cell content' }));
        const preview = await screen.findByRole('dialog', { name: 'Full cell content' });
        expect(within(preview).getByText('the complete value')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(within(preview).getByRole('button', { name: 'Copy full cell content' }));
        });

        expect(writeText).toHaveBeenCalledWith('the complete value');
        expect(screen.getByText('Copied').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    });

    it('reports an error when copying is unavailable', async () => {
        Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
        render(<LongTextCell copyText="the complete value">truncated…</LongTextCell>);
        const cell = screen.getByTestId('long-text-cell');
        setOverflow(cell, { width: true });
        fireEvent.mouseEnter(cell);

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy full cell content' }));
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Copy failed');
    });

    it('detects truncation in a nested field and removes the action when the value fits again', () => {
        render(
            <LongTextCell copyText="the complete value">
                <span data-testid="field-text">truncated…</span>
            </LongTextCell>,
        );
        const cell = screen.getByTestId('long-text-cell');
        const field = screen.getByTestId('field-text');
        setOverflow(cell);
        setOverflow(field, { width: true });
        fireEvent.mouseEnter(cell);
        expect(screen.getByRole('button', { name: 'Copy full cell content' })).toBeInTheDocument();

        setOverflow(field);
        fireEvent.mouseEnter(cell);
        expect(screen.queryByRole('button', { name: 'Copy full cell content' })).not.toBeInTheDocument();
    });

    it('offers copying for long wrapped text even when it fits without truncation', async () => {
        const fullText = 'Long wrapped log message. '.repeat(20);
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });
        render(<LongTextCell copyText={fullText}>{fullText}</LongTextCell>);
        const cell = screen.getByTestId('long-text-cell');
        setOverflow(cell);
        fireEvent.mouseEnter(cell);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy full cell content' }));
        });
        expect(writeText).toHaveBeenCalledWith(fullText);
    });

    it('copies full multiline text without triggering the parent cell action', async () => {
        const onCellClick = jest.fn();
        const writeText = jest.fn().mockResolvedValue(undefined);
        const fullText = 'First line\n第二行 with the complete value';
        Object.assign(navigator, { clipboard: { writeText } });
        render(
            <div onClick={onCellClick}>
                <LongTextCell copyText={fullText}>truncated…</LongTextCell>
            </div>,
        );
        const cell = screen.getByTestId('long-text-cell');
        setOverflow(cell, { width: true });
        fireEvent.focus(cell);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy full cell content' }));
        });

        expect(writeText).toHaveBeenCalledWith(fullText);
        expect(onCellClick).not.toHaveBeenCalled();
    });

    it('opens details explicitly, closes with Escape, and returns focus without triggering a cell action', async () => {
        const onCellClick = jest.fn();
        render(
            <div onClick={onCellClick}>
                <LongTextCell copyText={'long message '.repeat(30)} maxLines={3}>
                    preview…
                </LongTextCell>
            </div>,
        );
        const button = screen.getByRole('button', { name: 'View full cell content' });
        fireEvent.mouseEnter(screen.getByTestId('long-text-cell'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(button);
        const preview = await screen.findByRole('dialog', { name: 'Full cell content' });
        expect(button).toHaveAttribute('aria-expanded', 'true');
        fireEvent.keyDown(preview, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(button).toHaveFocus();
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(onCellClick).not.toHaveBeenCalled();
    });

    it('closes the old preview when a refreshed query supplies a different value', async () => {
        const { rerender } = render(<LongTextCell copyText={'old message '.repeat(30)}>old preview…</LongTextCell>);
        fireEvent.click(screen.getByRole('button', { name: 'View full cell content' }));
        await screen.findByRole('dialog');

        rerender(<LongTextCell copyText="new value">new value</LongTextCell>);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'View full cell content' })).not.toBeInTheDocument();
    });
});
