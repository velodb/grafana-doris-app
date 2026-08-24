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

function isFailedResponse(res: any) {
    const status = Number(res?.status);
    const responseError = res?.data?.error;

    return (
        res?.ok === false ||
        (Number.isFinite(status) && status >= 400) ||
        Boolean(responseError && !res?.data?.results)
    );
}

export function withErrorHandler<T>(
    source$: Observable<T>,
    options?: {
        showBackendError?: boolean;
        defaultMessage?: string;
        generatedSql?: string;
    }
): Observable<T> {
    const {
        showBackendError = true,
        defaultMessage = 'Request failed',
        generatedSql,
    } = options || {};

    return source$.pipe(
        map((res: any) => {
            const resultError = getFirstResultError(res?.data);
            if (isFailedResponse(res) || resultError) {
                throw createBackendError(res, defaultMessage);
            }

            return res;
        }),

        catchError((err: any) => {
            const queryError = err instanceof Error
                ? err as any
                : Object.assign(toError(err) as any, err && typeof err === 'object' ? err : {});
            if (generatedSql) {
                queryError.generatedSql = generatedSql;
            }
            logError(toError(queryError), { source: 'withErrorHandler' });
            if (showBackendError) {
                showGlobalError(getErrorText(queryError));
            }

            return throwError(() => queryError);
        })
    );
}
