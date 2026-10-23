import { DataSourceWithBackend } from '@grafana/runtime';
import type { DataSourceInstanceSettings } from '@grafana/data';
import type { DorisQuery, DorisSSOJsonData } from './types';

export class DataSource extends DataSourceWithBackend<DorisQuery, DorisSSOJsonData> {
    // Grafana detects modern datasource plugins by the single constructor
    // argument. Keep this explicit: a synthesized derived-class constructor has
    // length 0 and Grafana 11 otherwise routes it through the legacy Angular
    // injector.
    constructor(instanceSettings: DataSourceInstanceSettings<DorisSSOJsonData>) {
        super(instanceSettings);
    }
}
