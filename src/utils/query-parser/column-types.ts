export const normalizeColumnType = ({ dataType, columnType }: { dataType?: string; columnType?: string }): string => {
    const source = (columnType || dataType || '').trim();
    if (!source) {
        return '';
    }

    const lower = source.toLowerCase();

    if (lower.startsWith('nullable(') && lower.endsWith(')')) {
        const inner = source.slice(9, -1);
        const normalizedInner = normalizeColumnType({ dataType: inner, columnType: undefined });
        return normalizedInner ? `Nullable(${normalizedInner})` : source;
    }

    if (lower.startsWith('map')) {
        return source.replace(/^map/i, 'Map');
    }

    if (lower.startsWith('array')) {
        return source.replace(/^array/i, 'Array');
    }

    if (lower.startsWith('json')) {
        return 'JSON';
    }

    if (lower.startsWith('variant')) {
        return 'Variant';
    }

    if (lower === 'bool' || lower === 'boolean' || lower.startsWith('tinyint(1)')) {
        return 'Bool';
    }

    if (lower.startsWith('tinyint')) {
        return 'Int8';
    }

    if (lower.startsWith('smallint')) {
        return 'Int16';
    }

    if (lower.startsWith('mediumint')) {
        return 'Int32';
    }

    if (lower.startsWith('bigint') || lower.startsWith('int') || lower.startsWith('integer')) {
        return 'Int64';
    }

    if (lower.startsWith('float') || lower.startsWith('double') || lower.startsWith('real')) {
        return 'Float64';
    }

    if (lower.startsWith('decimal') || lower.startsWith('numeric')) {
        return 'Float64';
    }

    if (lower.startsWith('date')) {
        return source.replace(/^date/i, 'Date');
    }

    if (lower.startsWith('timestamp') || lower.startsWith('datetime')) {
        return 'DateTime';
    }

    if (lower.startsWith('enum')) {
        return source.replace(/^enum/i, 'Enum');
    }

    if (lower.startsWith('uuid')) {
        return 'UUID';
    }

    if (lower.startsWith('ipv4')) {
        return 'IPv4';
    }

    if (lower.startsWith('ipv6')) {
        return 'IPv6';
    }

    if (lower.startsWith('tuple')) {
        return source.replace(/^tuple/i, 'Tuple');
    }

    if (lower.startsWith('struct')) {
        return source.replace(/^struct/i, 'Tuple');
    }

    if (lower.startsWith('char') || lower.startsWith('varchar') || lower.startsWith('text') || lower.startsWith('string')) {
        return 'String';
    }

    return source;
};
