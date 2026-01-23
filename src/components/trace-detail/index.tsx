import { LoadingState } from '@grafana/data';
import { PanelRenderer } from '@grafana/runtime';
import { Drawer, LoadingPlaceholder } from '@grafana/ui';
import { useAtom, useAtomValue } from 'jotai';
import React, { useEffect } from 'react';
import { getTableDataTraceService } from 'services/traces';
import { currentCatalogAtom, currentDatabaseAtom, tableTracesDataAtom, selectedDatasourceAtom, selectedRowAtom } from 'store/discover';
import { currentTraceTableAtom } from 'store/traces';
import { formatTracesResData } from 'utils/data';

export default function TraceDetail(props: { onClose?: () => void; open: boolean; traceId?: string; traceTable?: string }) {
    const currentTable = useAtomValue(currentTraceTableAtom);
    const currentCatalog = useAtomValue(currentCatalogAtom);
    const currentDatabase = useAtomValue(currentDatabaseAtom);
    const [traceData, setTraceData] = useAtom(tableTracesDataAtom);
    const selectedRow = useAtomValue(selectedRowAtom);
    const selectdbDS = useAtomValue(selectedDatasourceAtom);
    const traceTable = props?.traceTable || currentTable || 'otel_traces';
    const [loading, setLoading] = React.useState(false);

    const { open, traceId } = props;

    const getTraceData = React.useCallback(() => {
        let payload: any = {
            catalog: currentCatalog,
            database: currentDatabase,
            table: traceTable,
            cluster: '',
            sort: 'DESC',
            trace_id: traceId || '',
        };
        setLoading(true);

        getTableDataTraceService({
            selectdbDS,
            ...payload,
        }).subscribe({
            next: ({ data, ok }: any) => {
                setLoading(false);
                if (ok) {
                    const formatedData = formatTracesResData(data.results.getTableDataTrace.frames[0]);
                    setTraceData(formatedData);
                }
            },
            error: (err: any) => {
                setLoading(false);
                console.log('Fetch Error', err);
            },
        });
    }, [currentCatalog, currentDatabase, traceTable, selectdbDS, setTraceData, traceId]);

    useEffect(() => {
        if (traceId) {
            getTraceData();
        }
    }, [selectedRow.trace_id, currentCatalog, currentDatabase, selectdbDS, setTraceData, getTraceData, traceId]);

    function renderTracePanel() {
        if (traceData) {
            return (
                <PanelRenderer
                    title="trace panel"
                    width={200}
                    height={300}
                    pluginId="traces"
                    options={{}}
                    data={{
                        state: loading ? LoadingState.Loading : LoadingState.Done,
                        series: [traceData],
                        timeRange: {
                            from: new Date(Date.now() - 15 * 60 * 1000) as any, // 15 分钟前
                            to: new Date() as any,
                            raw: {
                                from: 'now-15m',
                                to: 'now',
                            },
                        },
                    }}
                />
            );
        }
        return null;
    }

    return (
        <>
            {open && (
                <Drawer
                    title="Trace Panel"
                    onClose={() => {
                        props?.onClose?.();
                    }}
                    size="lg"
                >
                    {loading ? <LoadingPlaceholder text={`Loading`} /> : renderTracePanel()}
                </Drawer>
            )}
        </>
    );
}
