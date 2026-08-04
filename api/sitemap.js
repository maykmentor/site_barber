const { loadRemoteConfig } = require('../lib/supabase-config');
const { deriveSeo, escapeXml } = require('../lib/seo');

function getOrigin(req) {
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost:3000';
    const protocol = req.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
    return `${protocol}://${host}`;
}

function renderSitemap(canonical) {
    const entry = canonical
        ? `\n  <url>\n    <loc>${escapeXml(canonical)}</loc>\n  </url>`
        : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entry}\n</urlset>\n`;
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
        console.error('Erro ao gerar sitemap:', error);
    } finally {
        clearTimeout(timeout);
    }

    const seo = deriveSeo(config, getOrigin(req), { hasRemoteConfig: Boolean(config) });
    const xml = renderSitemap(seo.indexable ? seo.canonical : '');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).end(req.method === 'HEAD' ? undefined : xml);
};

module.exports.renderSitemap = renderSitemap;
