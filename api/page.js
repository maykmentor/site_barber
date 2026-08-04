const fs = require('fs');
const path = require('path');
const { loadRemoteConfig } = require('../lib/supabase-config');
const { deriveSeo, injectCriticalContent, injectSeoHead } = require('../lib/seo');

const INDEX_HTML = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

function getOrigin(req) {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost:3000';
    const protocol = req.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
    return `${protocol}://${host}`;
}

module.exports = async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).end();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let config = null;

    try {
        const result = await loadRemoteConfig(controller.signal);
        config = result.config;
    } catch (error) {
        console.error('Erro ao carregar SEO da pagina:', error);
    } finally {
        clearTimeout(timeout);
    }

    const seo = deriveSeo(config, getOrigin(req), { hasRemoteConfig: Boolean(config) });
    const html = injectCriticalContent(injectSeoHead(INDEX_HTML, seo), config);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', config
        ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
        : 'public, max-age=0, s-maxage=15, must-revalidate');
    res.setHeader('X-Robots-Tag', seo.robots);
    return res.status(200).end(req.method === 'HEAD' ? undefined : html);
};
