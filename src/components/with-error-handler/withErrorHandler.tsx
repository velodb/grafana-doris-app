import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { message } from 'antd';
import { logError } from '@grafana/runtime';
import { toError } from 'utils/errors';

const GLOBAL_ERROR_KEY = 'global_request_error';

function showGlobalError(msg: string) {
    message.error({
        content: msg,
        key: GLOBAL_ERROR_KEY,
        duration: 3,
    });
}

function getFirstResultError(data: any) {
    const results = data?.results;
    if (!results) {
        return undefined;
    }

    const refId = Object.keys(results).find(key => results[key]?.error || results[key]?.status >= 400);
    if (!refId) {
        return undefined;
    }

    return {
        refId,
        ...results[refId],
    };
}

function getErrorText(error: any) {
    const responseData = error?.data || error?.response?.data;
    const resultError = getFirstResultError(responseData);

    return (
        error?.backendError ||
        resultError?.error ||
        responseData?.error?.message ||
        responseData?.message ||
        error?.statusText ||
        error?.message ||
        'Request failed'
    );
}

function createBackendError(res: any, defaultMessage: string) {
    const resultError = getFirstResultError(res?.data);
    const err = new Error(getErrorText({
        data: res?.data,
        statusText: res?.statusText,
        message: defaultMessage,
    })) as any;

    err.name = 'BackendQueryError';
    err.data = res?.data;
    err.status = res?.status;
    err.statusText = res?.statusText;
    err.backendError = resultError?.error;
    err.backendStatus = resultError?.status;
    err.errorSource = resultError?.errorSource;
    err.refId = resultError?.refId;

    return err;
}

export function withErrorHandler<T>(
    source$: Observable<T>,
    options?: {
        showBackendError?: boolean;
        defaultMessage?: string;
    }
): Observable<T> {
    const {
        showBackendError = true,
        defaultMessage = 'Request failed',
    } = options || {};

    return source$.pipe(
        map((res: any) => {
            const resultError = getFirstResultError(res?.data);
            if (res?.ok === false || resultError) {
                throw createBackendError(res, defaultMessage);
            }

            return res;
        }),

        catchError((err: any) => {
            logError(toError(err), { source: 'withErrorHandler' });
            if (showBackendError) {
                showGlobalError(getErrorText(err));
            }

            return throwError(() => err);
        })
    );
}
