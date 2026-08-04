const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const {
    DEFAULT_ROBOTS_TXT,
    MAX_ROBOTS_BYTES,
    formatRobotsText,
    inspectRobotsText,
    isSiteBlocked,
    resolveRobotsText
} = require('../lib/robots');
const robotsHandler = require('../api/robots');
const validateRobotsHandler = require('../api/validate-robots');
const saveConfigHandler = require('../api/save-config');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const SAME_ORIGIN_HEADERS = { host: 'example.com', 'x-forwarded-proto': 'https' };

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
});

function createResponse() {
    return {
        headers: {},
        statusCode: null,
        body: undefined,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
        end(value) {
            this.body = value;
            return this;
        }
    };
}

test('configuração padrão é válida e formatada com quebra final', () => {
    const inspection = inspectRobotsText(DEFAULT_ROBOTS_TXT);

    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.warnings, []);
    assert.equal(formatRobotsText(DEFAULT_ROBOTS_TXT).endsWith('\n'), true);
});

test('novo namespace de robots tem prioridade e mantém fallback legado', () => {
    assert.equal(resolveRobotsText({
        robots: { txt: 'User-agent: *\nAllow: /novo' },
        seo: { robots_txt: 'User-agent: *\nDisallow: /legado' }
    }), 'User-agent: *\nAllow: /novo');
    assert.equal(resolveRobotsText({
        seo: { robots_txt: 'User-agent: *\nDisallow: /legado' }
    }), 'User-agent: *\nDisallow: /legado');
});

test('bloqueio global reconhece grupos múltiplos e wildcard', () => {
    assert.equal(isSiteBlocked([
        'User-agent: *',
        'User-agent: Googlebot',
        'Disallow: /*'
    ].join('\n')), true);
    assert.equal(isSiteBlocked([
        'User-agent: *',
        'Disallow: /',
        'Allow: /'
    ].join('\n')), false);
    assert.equal(isSiteBlocked('User-agent: *\nDisallow: /privado'), false);
});

test('inspeção rejeita tamanho excessivo e caractere nulo', () => {
    const inspection = inspectRobotsText(`${'a'.repeat(MAX_ROBOTS_BYTES + 1)}\0`);

    assert.equal(inspection.errors.length, 2);
    assert.match(inspection.errors[0], /excede o limite/);
    assert.match(inspection.errors[1], /caracteres nulos/);
});

test('inspeção alerta sobre diretivas problemáticas sem impedir publicação', () => {
    const inspection = inspectRobotsText([
        'Disallow: /antes-do-grupo',
        'User-agent: *',
        'Crawl-delay: 5',
        'Sitemap: /sitemap.xml',
        'Regra-inventada: valor'
    ].join('\n'));

    assert.deepEqual(inspection.errors, []);
    assert.equal(inspection.warnings.length, 4);
});

test('GET /robots.txt retorna 503 quando Supabase não está configurado', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    const res = createResponse();

    await robotsHandler({ method: 'GET' }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['retry-after'], '300');
});

test('HEAD /robots.txt indisponível não envia corpo', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    const res = createResponse();

    await robotsHandler({ method: 'HEAD' }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body, undefined);
});

test('GET /robots.txt retorna configuração do deployment correto', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_CONFIG_ID = 'cliente especial';
    let requestedUrl = '';
    global.fetch = async (url) => {
        requestedUrl = url;
        return {
            ok: true,
            json: async () => [{ dados: { seo: { robots_txt: 'User-agent: *\r\nDisallow: /privado' } } }]
        };
    };
    const res = createResponse();

    await robotsHandler({ method: 'GET' }, res);

    assert.match(requestedUrl, /id=eq\.cliente%20especial/);
    assert.equal(res.body, 'User-agent: *\nDisallow: /privado\n');
});

test('GET /robots.txt anuncia o sitemap do domínio quando não configurado', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({
        ok: true,
        json: async () => [{ dados: { robots: { txt: 'User-agent: *\nAllow: /' } } }]
    });
    const res = createResponse();

    await robotsHandler({
        method: 'GET',
        headers: { host: 'www.example.com', 'x-forwarded-proto': 'https' }
    }, res);

    assert.match(res.body, /Sitemap: https:\/\/www\.example\.com\/sitemap\.xml/);
});

test('GET /robots.txt usa o padrão quando o registro antigo não possui SEO', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({
        ok: true,
        json: async () => [{ dados: { general: { name: 'Cliente antigo' } } }]
    });
    const res = createResponse();

    await robotsHandler({ method: 'GET' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body, `${DEFAULT_ROBOTS_TXT}\n`);
});

test('falha do Supabase mantém semântica de indisponibilidade do protocolo', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({ ok: false, status: 503 });
    const res = createResponse();

    await robotsHandler({ method: 'GET' }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.headers['cache-control'], 'no-store');
});

test('robots.txt vazio permanece vazio e HEAD não envia corpo', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({
        ok: true,
        json: async () => [{ dados: { seo: { robots_txt: '' } } }]
    });
    const getResponse = createResponse();
    const headResponse = createResponse();

    await robotsHandler({ method: 'GET' }, getResponse);
    await robotsHandler({ method: 'HEAD' }, headResponse);

    assert.equal(getResponse.body, '');
    assert.equal(getResponse.headers['content-length'], 0);
    assert.equal(headResponse.body, undefined);
    assert.equal(headResponse.statusCode, 200);
});

test('métodos de escrita são rejeitados em /robots.txt', async () => {
    const res = createResponse();

    await robotsHandler({ method: 'POST' }, res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET, HEAD');
});

test('validador testa wildcard, precedência e linha aplicada', async () => {
    const res = createResponse();
    const content = [
        'User-agent: *',
        'Disallow: /privado/',
        'Allow: /privado/publico/'
    ].join('\n');

    await validateRobotsHandler({
        method: 'POST',
        headers: SAME_ORIGIN_HEADERS,
        body: {
            content,
            userAgent: 'Googlebot',
            url: 'https://example.com/privado/publico/pagina'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.allowed, true);
    assert.equal(res.body.matching_line, 3);
    assert.equal(res.body.matching_rule, 'Allow: /privado/publico/');
});

test('validador bloqueia URL coberta por Disallow', async () => {
    const res = createResponse();

    await validateRobotsHandler({
        method: 'POST',
        headers: SAME_ORIGIN_HEADERS,
        body: {
            content: 'User-agent: *\nDisallow: /admin',
            userAgent: 'Googlebot',
            url: 'https://example.com/admin/configuracoes'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.allowed, false);
    assert.equal(res.body.matching_line, 2);
});

test('validador preserva grupos conforme o parser do Google', async () => {
    const res = createResponse();
    const content = [
        'User-agent: BarBot',
        'Sitemap: https://example.com/sitemap.xml',
        'User-agent: *',
        'Disallow: /'
    ].join('\n');

    await validateRobotsHandler({
        method: 'POST',
        headers: SAME_ORIGIN_HEADERS,
        body: { content, userAgent: 'BarBot', url: 'https://example.com/qualquer-rota' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.allowed, false);
    assert.equal(res.body.matching_line, 4);
});

test('validador sempre permite buscar o próprio robots.txt', async () => {
    const res = createResponse();

    await validateRobotsHandler({
        method: 'POST',
        headers: SAME_ORIGIN_HEADERS,
        body: {
            content: 'User-agent: *\nDisallow: /',
            userAgent: 'Googlebot',
            url: 'https://example.com/robots.txt'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.allowed, true);
    assert.equal(res.body.matching_line, null);
});

test('validador mantém a semântica de percent-encoding do parser do Google', async () => {
    const res = createResponse();

    await validateRobotsHandler({
        method: 'POST',
        headers: SAME_ORIGIN_HEADERS,
        body: {
            content: 'User-agent: Googlebot\nDisallow: /\nAllow: /foo/bar/%62%61%7A',
            userAgent: 'Googlebot',
            url: 'https://example.com/foo/bar/%62%61%7A'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.allowed, true);
    assert.equal(res.body.matching_line, 3);
});

test('validador rejeita teste de outro domínio', async () => {
    const res = createResponse();

    await validateRobotsHandler({
        method: 'POST',
        headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
        body: {
            content: 'User-agent: *\nAllow: /',
            userAgent: 'Googlebot',
            url: 'https://outro.example.com/'
        }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /deste domínio/);
});

test('validador falha fechado quando não recebe o domínio do deployment', async () => {
    const res = createResponse();

    await validateRobotsHandler({
        method: 'POST',
        body: {
            content: 'User-agent: *\nAllow: /',
            userAgent: 'Googlebot',
            url: 'https://example.com/'
        }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /determinar o domínio/);
});

test('save-config exige sessão antes de inspecionar conteúdo grande', async () => {
    const res = createResponse();

    await saveConfigHandler({
        method: 'POST',
        body: {
            config: { seo: { robots_txt: 'a'.repeat(MAX_ROBOTS_BYTES + 1) } }
        }
    }, res);

    assert.equal(res.statusCode, 401);
});
