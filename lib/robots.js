const MAX_ROBOTS_BYTES = 500 * 1024;

const DEFAULT_ROBOTS_TXT = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin.html',
    'Disallow: /api/'
].join('\n');

function normalizeRobotsText(value) {
    if (typeof value !== 'string') {
        throw new TypeError('O conteúdo do robots.txt deve ser um texto.');
    }

    return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function inspectRobotsText(value) {
    const errors = [];
    const warnings = [];
    let normalized = '';

    if (typeof value !== 'string') {
        return {
            normalized,
            bytes: 0,
            errors: ['O conteúdo do robots.txt deve ser um texto.'],
            warnings
        };
    }

    normalized = normalizeRobotsText(value);
    const bytes = Buffer.byteLength(normalized, 'utf8');

    if (bytes > MAX_ROBOTS_BYTES) {
        errors.push(`O robots.txt excede o limite de ${MAX_ROBOTS_BYTES} bytes.`);
    }

    if (normalized.includes('\0')) {
        errors.push('O robots.txt não pode conter caracteres nulos.');
    }

    if (errors.length > 0) {
        return { normalized, bytes, errors, warnings };
    }

    let hasUserAgent = false;
    let activeGroupHasAgent = false;
    let activeGroupHasRule = false;

    normalized.split('\n').forEach((originalLine, index) => {
        const lineNumber = index + 1;
        const line = originalLine.replace(/#.*$/, '').trim();

        if (!line) return;

        const separator = line.indexOf(':');
        if (separator === -1) {
            warnings.push(`Linha ${lineNumber}: diretiva sem dois-pontos será ignorada.`);
            return;
        }

        const directive = line.slice(0, separator).trim().toLowerCase();
        const directiveValue = line.slice(separator + 1).trim();

        if (directive === 'user-agent') {
            if (activeGroupHasRule) {
                activeGroupHasAgent = false;
                activeGroupHasRule = false;
            }
            if (!directiveValue) {
                warnings.push(`Linha ${lineNumber}: User-agent vazio será ignorado.`);
                return;
            }
            const productToken = directiveValue.split(/\s/, 1)[0];
            if (productToken !== '*' && !/^[a-z_-]+$/i.test(productToken)) {
                warnings.push(`Linha ${lineNumber}: User-agent contém um identificador inválido.`);
            }
            hasUserAgent = true;
            activeGroupHasAgent = true;
            return;
        }

        if (directive === 'allow' || directive === 'disallow') {
            if (!activeGroupHasAgent) {
                warnings.push(`Linha ${lineNumber}: ${directive} está fora de um grupo User-agent.`);
            }
            if (directiveValue && !directiveValue.startsWith('/')) {
                warnings.push(`Linha ${lineNumber}: o caminho de ${directive} deve começar com uma barra.`);
            }
            activeGroupHasRule = true;
            return;
        }

        if (directive === 'sitemap') {
            try {
                const sitemapUrl = new URL(directiveValue);
                if (!['http:', 'https:'].includes(sitemapUrl.protocol)) {
                    throw new Error('Protocolo inválido');
                }
            } catch (_error) {
                warnings.push(`Linha ${lineNumber}: Sitemap deve usar uma URL absoluta HTTP ou HTTPS.`);
            }
            return;
        }

        if (directive === 'crawl-delay') {
            warnings.push(`Linha ${lineNumber}: Crawl-delay não é suportado pelo Google.`);
            return;
        }

        if (directive === 'host') {
            warnings.push(`Linha ${lineNumber}: Host não é uma diretiva suportada pelo Google.`);
            return;
        }

        warnings.push(`Linha ${lineNumber}: diretiva "${directive || '(vazia)'}" desconhecida.`);
    });

    if (normalized.trim() && !hasUserAgent) {
        warnings.push('Nenhum grupo User-agent válido foi encontrado.');
    }

    return { normalized, bytes, errors, warnings };
}

function formatRobotsText(value) {
    const normalized = normalizeRobotsText(value);
    if (!normalized) return '';
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function resolveRobotsText(config, fallback = DEFAULT_ROBOTS_TXT) {
    if (config?.robots && Object.prototype.hasOwnProperty.call(config.robots, 'txt')) {
        return config.robots.txt;
    }
    if (config?.seo && Object.prototype.hasOwnProperty.call(config.seo, 'robots_txt')) {
        return config.seo.robots_txt;
    }
    return fallback;
}

function isSiteBlocked(value) {
    if (typeof value !== 'string') return false;
    let groupAgents = [];
    let groupHasRule = false;
    let strongestDisallow = 0;
    let strongestAllow = 0;

    normalizeRobotsText(value).split('\n').forEach(originalLine => {
        const line = originalLine.replace(/#.*$/, '').trim();
        if (!line) return;
        const separator = line.indexOf(':');
        if (separator === -1) return;
        const directive = line.slice(0, separator).trim().toLowerCase();
        const directiveValue = line.slice(separator + 1).trim();

        if (directive === 'user-agent') {
            if (groupHasRule) {
                groupAgents = [];
                groupHasRule = false;
            }
            groupAgents.push(directiveValue.toLowerCase());
            return;
        }
        if (!['allow', 'disallow'].includes(directive)) return;
        groupHasRule = true;
        if (!groupAgents.includes('*') || !/^\/\**\$?$/.test(directiveValue)) return;
        if (directive === 'disallow') strongestDisallow = Math.max(strongestDisallow, directiveValue.length);
        if (directive === 'allow') strongestAllow = Math.max(strongestAllow, directiveValue.length);
    });

    return strongestDisallow > 0 && strongestDisallow > strongestAllow;
}

module.exports = {
    DEFAULT_ROBOTS_TXT,
    MAX_ROBOTS_BYTES,
    formatRobotsText,
    inspectRobotsText,
    isSiteBlocked,
    normalizeRobotsText,
    resolveRobotsText
};
