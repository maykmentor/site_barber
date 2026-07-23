const {
    DEFAULT_ROBOTS_TXT,
    formatRobotsText,
    inspectRobotsText
} = require('../lib/robots');

function sendRobots(res, method, content) {
    const formatted = formatRobotsText(content);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(formatted, 'utf8'));
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(method === 'HEAD' ? undefined : formatted);
}

function sendUnavailable(res, method) {
    const message = 'Robots configuration temporarily unavailable.\n';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(503).end(method === 'HEAD' ? undefined : message);
}

module.exports = async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const configId = process.env.SUPABASE_CONFIG_ID || 'barber_config';

    if (!supabaseUrl || !supabaseKey) {
        return sendUnavailable(res, req.method);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/configuracoes?id=eq.${encodeURIComponent(configId)}&select=dados`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`
                },
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error(`Supabase respondeu com status ${response.status}.`);
        }

        const rows = await response.json();
        const configuredValue = rows?.[0]?.dados?.seo?.robots_txt;
        const content = typeof configuredValue === 'string' ? configuredValue : DEFAULT_ROBOTS_TXT;
        const inspection = inspectRobotsText(content);

        if (inspection.errors.length > 0) {
            console.error('robots.txt salvo é inválido:', inspection.errors.join(' '));
            return sendUnavailable(res, req.method);
        }

        return sendRobots(res, req.method, inspection.normalized);
    } catch (error) {
        console.error('Erro ao carregar robots.txt do Supabase:', error);
        return sendUnavailable(res, req.method);
    } finally {
        clearTimeout(timeout);
    }
};
