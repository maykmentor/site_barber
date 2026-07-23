const { MAX_ROBOTS_BYTES, inspectRobotsText } = require('../lib/robots');

let parserModulePromise;

function loadParserModule() {
    if (!parserModulePromise) {
        parserModulePromise = import('@trybyte/robotstxt-parser');
    }
    return parserModulePromise;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const { content, userAgent = 'Googlebot', url } = req.body || {};
    if (typeof content !== 'string') {
        return res.status(400).json({ success: false, error: 'O conteúdo do robots.txt deve ser um texto.' });
    }

    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_ROBOTS_BYTES) {
        return res.status(413).json({
            success: false,
            error: `O robots.txt excede o limite de ${MAX_ROBOTS_BYTES} bytes.`
        });
    }

    if (typeof userAgent !== 'string' || !userAgent.trim() || userAgent.length > 200) {
        return res.status(400).json({ success: false, error: 'Informe um user-agent válido.' });
    }

    if (typeof url !== 'string' || url.length > 2048) {
        return res.status(400).json({ success: false, error: 'Informe uma URL com até 2048 caracteres.' });
    }

    const inspection = inspectRobotsText(content);
    if (inspection.errors.length > 0) {
        return res.status(400).json({
            success: false,
            error: inspection.errors[0],
            errors: inspection.errors,
            warnings: inspection.warnings,
            bytes: inspection.bytes
        });
    }

    let targetUrl;
    try {
        targetUrl = new URL(url);
        if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            throw new Error('Protocolo inválido');
        }
    } catch (_error) {
        return res.status(400).json({ success: false, error: 'Informe uma URL absoluta HTTP ou HTTPS.' });
    }

    try {
        const headers = req.headers || {};
        const forwardedHost = headers['x-forwarded-host'] || headers.host;
        if (!forwardedHost) {
            return res.status(400).json({ success: false, error: 'Não foi possível determinar o domínio deste deployment.' });
        }

        const requestHost = forwardedHost.split(',')[0].trim();
        const forwardedProto = headers['x-forwarded-proto'] || (requestHost.startsWith('localhost') ? 'http' : 'https');
        const requestOrigin = new URL(`${forwardedProto.split(',')[0].trim()}://${requestHost}`).origin;
        if (targetUrl.origin !== requestOrigin) {
            return res.status(400).json({ success: false, error: 'Teste apenas URLs deste domínio.' });
        }

        const { ParsedRobots } = await loadParserModule();
        const parsedRobots = ParsedRobots.parse(inspection.normalized);
        const parserResult = parsedRobots.checkUrl(userAgent.trim(), targetUrl.toString());
        const isRobotsFile = targetUrl.pathname === '/robots.txt';
        const allowed = isRobotsFile ? true : parserResult.allowed;
        const matchingLine = isRobotsFile ? 0 : parserResult.matchingLine;
        const lines = inspection.normalized.split('\n');

        return res.status(200).json({
            success: true,
            allowed,
            matching_line: matchingLine > 0 ? matchingLine : null,
            matching_rule: matchingLine > 0 ? lines[matchingLine - 1].trim() : null,
            warnings: inspection.warnings,
            bytes: inspection.bytes
        });
    } catch (error) {
        console.error('Erro ao validar robots.txt:', error);
        return res.status(500).json({ success: false, error: 'Não foi possível validar o robots.txt.' });
    }
};
