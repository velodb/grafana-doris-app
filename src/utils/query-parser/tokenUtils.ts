const VARIANT_LITERAL_KEY_PREFIX = '__HDX_VARIANT_KEY_';

function encodeVariantKey(value: string): string {
    return Array.from(new TextEncoder().encode(value))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function decodeVariantKey(value: string): string | undefined {
    if (!value.startsWith(VARIANT_LITERAL_KEY_PREFIX)) {
        return undefined;
    }
    const hex = value.slice(VARIANT_LITERAL_KEY_PREFIX.length);
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        return undefined;
    }
    try {
        const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)));
        return new TextDecoder().decode(bytes);
    } catch {
        return undefined;
    }
}

/**
 * Makes a literal VARIANT key parser-safe. For example,
 * attrs["k8s.pod.name"] becomes attrs.__HDX_VARIANT_KEY_6b... .
 */
export function encodeVariantLiteralFieldPaths(query: string): string {
    let normalized = query;
    let previous: string | undefined;
    const bracketedKey = /([A-Za-z_][A-Za-z0-9_.]*)(?:\["((?:\\.|[^"\\])*)"\])/g;

    do {
        previous = normalized;
        normalized = normalized.replace(bracketedKey, (_match, field: string, escapedKey: string) => {
            let key: string;
            try {
                key = JSON.parse(`"${escapedKey}"`);
            } catch {
                return _match;
            }
            return `${field}.${VARIANT_LITERAL_KEY_PREFIX}${encodeVariantKey(key)}`;
        });
    } while (normalized !== previous);

    return normalized;
}

export function splitVariantFieldPath(field: string): string[] {
    return field.split('.').map(segment => decodeVariantKey(segment) ?? segment);
}

export function encodeSpecialTokens(query: string): string {
    return query
        .replace(/\\\\/g, 'HDX_BACKSLASH_LITERAL')
        .replace('http://', 'http_COLON_//')
        .replace('https://', 'https_COLON_//')
        .replace(/localhost:(\d{1,5})/, 'localhost_COLON_$1')
        .replace(/\\:/g, 'HDX_COLON');
}

export function decodeSpecialTokens(query: string): string {
    return query
        .replace(/\\"/g, '"')
        .replace(/HDX_BACKSLASH_LITERAL/g, '\\')
        .replace('http_COLON_//', 'http://')
        .replace('https_COLON_//', 'https://')
        .replace(/localhost_COLON_(\d{1,5})/, 'localhost:$1')
        .replace(/HDX_COLON/g, ':');
}
