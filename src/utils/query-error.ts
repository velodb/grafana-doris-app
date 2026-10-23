import { t } from 'i18n';
import { DiscoverQueryError, DiscoverQueryLocation, DiscoverQuerySource } from 'types/discover';

type QueryErrorContext = {
    source: DiscoverQuerySource;
    searchType: 'SQL' | 'Search' | 'Lucene';
    searchValue?: string;
};

function getFirstResultError(data: any) {
    const results = data?.results;
    if (!results) {
        return undefined;
    }

    const refId = Object.keys(results).find(key => results[key]?.error || results[key]?.status >= 400);
    return refId ? results[refId] : undefined;
}

export function getQueryErrorMessage(error: any): string {
    const responseData = error?.data || error?.response?.data;
    const resultError = getFirstResultError(responseData);

    return String(
        error?.backendError ||
        resultError?.error ||
        responseData?.error?.message ||
        (typeof responseData?.error === 'string' ? responseData.error : undefined) ||
        responseData?.message ||
        error?.message ||
        error?.statusText ||
        (typeof error === 'string' ? error : undefined) ||
        t('Request failed'),
    );
}

function getAbsolutePosition(sql: string, line?: number, column?: number): number | undefined {
    if (!line || !column || line < 1 || column < 1) {
        return undefined;
    }

    const lines = sql.split('\n');
    if (line > lines.length) {
        return undefined;
    }

    let offset = 0;
    for (let index = 0; index < line - 1; index += 1) {
        offset += lines[index].length + 1;
    }

    return offset + column;
}

function getInputLineAndColumn(input: string, position: number) {
    const before = input.slice(0, Math.max(position - 1, 0));
    const lines = before.split('\n');
    return {
        inputLine: lines.length,
        inputColumn: (lines[lines.length - 1]?.length || 0) + 1,
    };
}

function extractLocation(error: any, message: string, generatedSql?: string, searchValue?: string): DiscoverQueryLocation | undefined {
    const nativeLocation = error?.location?.start || error?.location;
    const location: DiscoverQueryLocation = {};

    if (nativeLocation?.line) {
        location.line = Number(nativeLocation.line);
        location.column = Number(nativeLocation.column || 1);
        location.inputLine = location.line;
        location.inputColumn = location.column;
    } else {
        const lineColumnMatch = message.match(/line\s+(\d+)\s*(?:,|:)?\s*(?:column|col)\s+(\d+)/i);
        const compactLineMatch = message.match(/line\s+(\d+)\s*[:]\s*(\d+)/i);
        const matchedLocation = lineColumnMatch || compactLineMatch;
        if (matchedLocation) {
            location.line = Number(matchedLocation[1]);
            location.column = Number(matchedLocation[2]);
        } else {
            const lineOnlyMatch = message.match(/(?:syntax error in|at)\s+line\s+(\d+)/i);
            if (lineOnlyMatch) {
                location.line = Number(lineOnlyMatch[1]);
            }
        }

        const messageLines = message.split('\n');
        const syntaxLineIndex = messageLines.findIndex(line => /syntax error in line\s+\d+/i.test(line));
        if (syntaxLineIndex >= 0) {
            const caretLine = messageLines.slice(syntaxLineIndex + 1, syntaxLineIndex + 5).find(line => line.includes('^'));
            const caretColumn = caretLine?.indexOf('^');
            if (caretColumn !== undefined && caretColumn >= 0) {
                location.column = caretColumn + 1;
            }
        }
    }

    const positionMatch = message.match(/(?:position|pos)\s*[:=]?\s*(\d+)/i);
    if (positionMatch) {
        location.position = Number(positionMatch[1]);
    }

    const nearMatch = message.match(/near\s+['"`]?([^'"`\n]{1,80})/i);
    if (nearMatch) {
        location.near = nearMatch[1].trim().replace(/\s+at\s+line.*$/i, '');
    }

    if (generatedSql && searchValue) {
        const inputStart = generatedSql.indexOf(searchValue);
        const absolutePosition = location.position || getAbsolutePosition(generatedSql, location.line, location.column);
        let inputPosition: number | undefined;

        if (inputStart >= 0 && absolutePosition && absolutePosition > inputStart && absolutePosition <= inputStart + searchValue.length + 1) {
            inputPosition = absolutePosition - inputStart;
        } else if (location.near) {
            const nearPosition = searchValue.indexOf(location.near);
            if (nearPosition >= 0) {
                inputPosition = nearPosition + 1;
            }
        }

        if (inputPosition) {
            location.inputPosition = inputPosition;
            Object.assign(location, getInputLineAndColumn(searchValue, inputPosition));
        }
    }

    return Object.keys(location).length > 0 ? location : undefined;
}

function getLikelyCause(message: string) {
    const normalized = message.toLowerCase();
    if (normalized.includes('an error occurred within the plugin')) {
        return t('Grafana did not return the underlying plugin error. Check the Grafana server/plugin logs for the cause, or ask your administrator.');
    }
    if (normalized.includes('oidc id token is required')) {
        return t('Sign in with OIDC and enable Forward OAuth Identity for this datasource, then retry the query.');
    }
    if (/oidc id token validation failed/.test(normalized)) {
        return t('Sign in again to refresh your OIDC session. If the error persists, check the identity provider issuer, audience, and signing keys.');
    }
    if (/sso profile|jwks|oidc|keyrock|identity provider/.test(normalized)) {
        return t('Check the Doris SSO Profile and identity provider configuration using the backend message.');
    }
    if (/syntax|parse|mismatched|unexpected|unterminated|no viable|expected/.test(normalized)) {
        return t('Check SQL/Lucene keywords, operators, quotes, and matching parentheses near the reported position.');
    }
    if (/unknown column|column .* not found|cannot resolve|unresolved column/.test(normalized)) {
        return t('A referenced field may not exist in the selected table, or its name/case may be incorrect.');
    }
    if (/cast|type mismatch|incompatible|invalid type|cannot convert/.test(normalized)) {
        return t('The expression may compare or convert incompatible data types.');
    }
    if (/permission|access denied|not authorized|unauthorized|forbidden/.test(normalized)) {
        return t('The selected datasource user may not have permission to query this table or field.');
    }
    if (/timeout|timed out|deadline/.test(normalized)) {
        return t('The query exceeded its time limit. Narrow the time range or simplify the filters.');
    }
    if (/network|failed to fetch|connection|gateway|unavailable/.test(normalized)) {
        return t('The datasource or Grafana backend could not be reached. Check connectivity and datasource health.');
    }
    return t('Review the backend message and generated query for invalid fields, expressions, or datasource-specific syntax.');
}

export function createDiscoverQueryError(error: any, context: QueryErrorContext): DiscoverQueryError {
    const message = getQueryErrorMessage(error);
    const generatedSql = typeof error?.generatedSql === 'string' ? error.generatedSql : undefined;
    const sourceLabel = context.source === 'results' ? t('Query') : context.source === 'lucene' ? t('Lucene query') : context.source === 'histogram' ? t('Histogram') : context.source === 'count' ? t('Count') : context.source === 'topData' ? t('Top values') : t('Field statistics');

    return {
        source: context.source,
        summary: t('{{source}} failed', { source: sourceLabel }),
        message,
        likelyCause: getLikelyCause(message),
        location: extractLocation(error, message, generatedSql, context.searchValue),
        generatedSql,
    };
}
