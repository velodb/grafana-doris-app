import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { message } from 'antd';

const GLOBAL_ERROR_KEY = 'global_request_error';

function showGlobalError(msg: string) {
    message.error({
        content: msg,
        key: GLOBAL_ERROR_KEY,
        duration: 3,
    });
}

function getErrorText(error: any) {
    return error?.data?.results[Object.keys(error?.data?.results)?.[0]]?.error || error.statusText || 'Request failed';
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
            if (res?.ok === false) {
                const errMsg =
                    res?.data?.error?.message ||
                    res?.data?.message ||
                    defaultMessage;

                if (showBackendError) {
                    showGlobalError(getErrorText(res?.data?.error));
                }

                throw new Error(errMsg);
            }

            return res;
        }),

        catchError((err: any) => {
            console.log('error catch', err);
            showGlobalError(getErrorText(err));

            return throwError(() => err);
        })
    );
}