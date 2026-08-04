const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const pageHandler = require('../api/page');
const sitemapHandler = require('../api/sitemap');
const saveConfigHandler = require('../api/save-config');
const { getSocialImageDirectory } = require('../lib/social-image-storage');
const {
    deriveSeo,
    injectCriticalContent,
    injectSeoHead,
    parseOpeningHours
} = require('../lib/seo');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

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
        end(value) {
            this.body = value;
            return this;
        }
    };
}

function createConfig(overrides = {}) {
    return {
        general: {
            name: 'Athenas Barbearia',
            whatsapp: '+55 65 99999-9999',
            instagram_url: 'https://instagram.com/athenas',
            facebook_url: ''
        },
        location: {
            city: 'Lucas do Rio Verde - SP',
            address: 'Av. Mato Grosso, 189e - Centro, Lucas do Rio Verde - MT, 78455-000',
            hours: 'Segunda a Sábado: 09h às 20h'
        },
        hero: { bg_image: '/assets/images/hero-bg.webp' },
        services: [
            { name: 'Corte na tesoura' },
            { name: 'Degradê' },
            { name: 'Visagismo' }
        ],
        seo: { canonical_url: 'https://www.example.com/' },
        ...overrides
    };
}

test('SEO local corrige o estado pelo endereço e gera dados estruturados', () => {
    const seo = deriveSeo(createConfig(), 'https://www.example.com', { hasRemoteConfig: true });

    assert.equal(seo.indexable, true);
    assert.match(seo.title, /Lucas do Rio Verde - MT/);
    assert.equal(seo.canonical, 'https://www.example.com/');
    assert.equal(seo.business['@type'], 'HairSalon');
    assert.equal(seo.business.address.addressRegion, 'MT');
    assert.equal(seo.business.openingHours, 'Mo-Sa 09:00-20:00');
    assert.equal(seo.business.hasOfferCatalog.itemListElement.length, 3);
});

test('configuração ausente ou genérica permanece noindex', () => {
    const missing = deriveSeo(null, 'https://site.example.com', { hasRemoteConfig: false });
    const placeholder = deriveSeo({
        general: { name: 'Barber Premium' },
        location: { city: 'São Paulo - SP', address: 'Av. Paulista, 1000 - São Paulo - SP' }
    }, 'https://site.example.com', { hasRemoteConfig: true });

    assert.equal(missing.indexable, false);
    assert.equal(missing.robots, 'noindex,follow');
    assert.equal(placeholder.indexable, false);
});

test('empresa real em São Paulo pode ser indexada', () => {
    const seo = deriveSeo({
        general: { name: 'Barbearia Vila Nova' },
        location: {
            city: 'São Paulo - SP',
            address: 'Rua das Flores, 42 - Vila Mariana, São Paulo - SP, 04000-000'
        },
        seo: { canonical_url: 'https://vilanova.example.com/' }
    }, 'https://vilanova.example.com', { hasRemoteConfig: true });

    assert.equal(seo.indexable, true);
});

test('alias ou preview diferente do canonical oficial permanece noindex', () => {
    const seo = deriveSeo(createConfig(), 'https://preview.vercel.app', { hasRemoteConfig: true });

    assert.equal(seo.indexable, false);
    assert.equal(seo.canonical, 'https://www.example.com/');
});

test('bloqueio global no robots remove a página do índice e do sitemap', () => {
    const seo = deriveSeo(createConfig({
        robots: { txt: 'User-agent: *\nDisallow: /' }
    }), 'https://www.example.com', { hasRemoteConfig: true });

    assert.equal(seo.indexable, false);
    assert.equal(seo.robots, 'noindex,follow');
});

test('campos SEO explícitos prevalecem sobre os fallbacks', () => {
    const seo = deriveSeo(createConfig({
        seo: {
            title: 'Título personalizado',
            description: 'Descrição personalizada',
            canonical_url: 'https://canonical.example.com/',
            social_title: 'Título social',
            social_description: 'Descrição social',
            social_image_url: '/social.jpg'
        }
    }), 'https://request.example.com', { hasRemoteConfig: true });

    assert.equal(seo.title, 'Título personalizado');
    assert.equal(seo.description, 'Descrição personalizada');
    assert.equal(seo.canonical, 'https://canonical.example.com/');
    assert.equal(seo.socialTitle, 'Título social');
    assert.equal(seo.socialImage, 'https://canonical.example.com/social.jpg');
});

test('injeção substitui o bloco SEO no HTML inicial', () => {
    const html = '<head><!-- SEO_DYNAMIC_START --><title>Antigo</title><!-- SEO_DYNAMIC_END --></head>';
    const seo = deriveSeo(createConfig(), 'https://www.example.com', { hasRemoteConfig: true });
    const result = injectSeoHead(html, seo);

    assert.doesNotMatch(result, /<title>Antigo<\/title>/);
    assert.match(result, /Athenas Barbearia/);
    assert.match(result, /application\/ld\+json/);
    assert.match(result, /rel="canonical"/);
});

test('imagem gerenciada no Storage publica dimensões Open Graph', () => {
    const html = '<head><!-- SEO_DYNAMIC_START --><title>Antigo</title><!-- SEO_DYNAMIC_END --></head>';
    const seo = deriveSeo(createConfig({
        seo: {
            canonical_url: 'https://www.example.com/',
            social_image_url: 'https://project.supabase.co/storage/v1/object/public/seo-assets/site/social-hash.jpg'
        }
    }), 'https://www.example.com', {
        hasRemoteConfig: true,
        supabaseUrl: 'https://project.supabase.co'
    });
    const result = injectSeoHead(html, seo);

    assert.match(result, /property="og:image:width" content="1200"/);
    assert.match(result, /property="og:image:height" content="630"/);
    assert.match(result, /property="og:image:type" content="image\/jpeg"/);
});

test('conteúdo local crítico é entregue sem depender de JavaScript', () => {
    const html = [
        '<h1 id="hero-title">Título antigo</h1>',
        '<h3 id="serv-0-name">Serviço antigo</h3>',
        '<span id="loc-address">Endereço antigo</span>'
    ].join('');
    const result = injectCriticalContent(html, createConfig({
        hero: { title: 'Experiência Athenas' }
    }));

    assert.match(result, /<h1 id="hero-title">Experiência Athenas<\/h1>/);
    assert.match(result, /<h3 id="serv-0-name">Corte na tesoura<\/h3>/);
    assert.match(result, /Av\. Mato Grosso/);
});

test('merge moderno preserva SEO e remove robots legado', () => {
    const result = saveConfigHandler.mergeStoredConfig({
        seo: { title: 'Título existente', robots_txt: 'User-agent: *' },
        robots: { txt: 'User-agent: *\nDisallow: /antigo' }
    }, {
        seo: { description: 'Nova descrição' },
        robots: { txt: 'User-agent: *\nAllow: /' }
    }, 'User-agent: *\nAllow: /', { hasModernRobots: true });

    assert.equal(result.seo.title, 'Título existente');
    assert.equal(result.seo.description, 'Nova descrição');
    assert.equal(Object.hasOwn(result.seo, 'robots_txt'), false);
    assert.equal(result.robots.txt, 'User-agent: *\nAllow: /');
});

test('cleanup reconhece apenas imagem social do projeto Supabase', () => {
    const configId = 'site_brothers';
    const directory = getSocialImageDirectory(configId);
    assert.equal(
        saveConfigHandler.getManagedSocialImagePath(
            `https://project.supabase.co/storage/v1/object/public/seo-assets/${directory}/social-hash.jpg`,
            'https://project.supabase.co',
            configId
        ),
        `${directory}/social-hash.jpg`
    );
    assert.equal(
        saveConfigHandler.getManagedSocialImagePath(
            `https://outro.example.com/storage/v1/object/public/seo-assets/${directory}/social-hash.jpg`,
            'https://project.supabase.co',
            configId
        ),
        ''
    );
    assert.equal(
        saveConfigHandler.getManagedSocialImagePath(
            'https://project.supabase.co/storage/v1/object/public/seo-assets/outro-site/social-hash.jpg',
            'https://project.supabase.co',
            configId
        ),
        ''
    );
});

test('cleanup remove a imagem anterior pelo contrato REST do Storage', async () => {
    const configId = 'site_brothers';
    const directory = getSocialImageDirectory(configId);
    let request;
    global.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, text: async () => '' };
    };

    await saveConfigHandler.deletePreviousSocialImage(
        `https://project.supabase.co/storage/v1/object/public/seo-assets/${directory}/social-old.jpg`,
        '',
        'https://project.supabase.co',
        'service-key',
        configId
    );

    assert.equal(request.url, 'https://project.supabase.co/storage/v1/object/seo-assets');
    assert.equal(request.options.method, 'DELETE');
    assert.deepEqual(JSON.parse(request.options.body), {
        prefixes: [`${directory}/social-old.jpg`]
    });
});

test('página dinâmica entrega metadados no HTML inicial', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({
        ok: true,
        json: async () => [{ dados: createConfig({
            seo: {
                title: 'SEO no servidor',
                canonical_url: 'https://www.example.com/'
            }
        }) }]
    });
    const res = createResponse();

    await pageHandler({
        method: 'GET',
        headers: { host: 'www.example.com', 'x-forwarded-proto': 'https' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-robots-tag'].startsWith('index,follow'), true);
    assert.match(res.body, /<title id="site-title-tag">SEO no servidor<\/title>/);
    assert.match(res.body, /https:\/\/www\.example\.com\/#business/);
    assert.match(res.body, /<h3 id="serv-0-name"[^>]*>Corte na tesoura<\/h3>/);
});

test('sitemap omite site sem configuração oficial', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = async () => ({ ok: true, json: async () => [] });
    const res = createResponse();

    await sitemapHandler({
        method: 'GET',
        headers: { host: 'site.example.com', 'x-forwarded-proto': 'https' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.body, /<url>/);
});

test('parser converte horário local legível para schema.org', () => {
    assert.equal(parseOpeningHours('Segunda a Sábado: 09h às 20h'), 'Mo-Sa 09:00-20:00');
    assert.deepEqual(
        parseOpeningHours('Segunda a sexta: 09h às 18h; sábado: 09h às 13h'),
        ['Mo-Fr 09:00-18:00', 'Sa 09:00-13:00']
    );
    assert.equal(parseOpeningHours('Horário sob consulta'), '');
});
