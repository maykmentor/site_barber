const SEO_BLOCK_PATTERN = /<!-- SEO_DYNAMIC_START -->[\s\S]*?<!-- SEO_DYNAMIC_END -->/;
const { isSiteBlocked, resolveRobotsText } = require('./robots');

function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeXml(value) {
    return escapeHtml(value);
}

function safeUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value.trim(), base);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch (_error) {
        return '';
    }
}

function truncate(value, limit) {
    const text = cleanText(value);
    if (text.length <= limit) return text;
    const shortened = text.slice(0, limit - 1);
    const boundary = shortened.lastIndexOf(' ');
    return `${shortened.slice(0, boundary > limit * 0.65 ? boundary : shortened.length).trim()}…`;
}

function getLocation(config) {
    const location = config?.location || {};
    const cityValue = cleanText(location.city);
    const address = cleanText(location.address);
    const cityParts = cityValue.split(/\s+-\s+/);
    const locality = cleanText(cityParts[0]);
    const stateMatches = Array.from(address.matchAll(/-\s*([A-Z]{2})(?=\s*(?:,|$))/g));
    const region = stateMatches.at(-1)?.[1] || cleanText(cityParts[1]).slice(0, 2).toUpperCase();
    const postalCode = address.match(/\b\d{5}-?\d{3}\b/)?.[0] || '';

    return {
        address,
        locality,
        region,
        postalCode,
        label: locality && region ? `${locality} - ${region}` : locality || cityValue
    };
}

function parseOpeningHours(value) {
    const text = cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const entries = text.split(/[;\n]/).map(segment => {
        const times = segment.match(/(\d{1,2})(?:h|:)(\d{2})?\s*(?:as|a)\s*(\d{1,2})(?:h|:)(\d{2})?/i);
        if (!times) return '';

        let days = '';
        if (segment.includes('segunda') && segment.includes('sabado')) days = 'Mo-Sa';
        else if (segment.includes('segunda') && segment.includes('sexta')) days = 'Mo-Fr';
        else if (segment.includes('sabado')) days = 'Sa';
        else if (segment.includes('domingo')) days = 'Su';
        if (!days) return '';

        const opens = `${times[1].padStart(2, '0')}:${(times[2] || '00').padStart(2, '0')}`;
        const closes = `${times[3].padStart(2, '0')}:${(times[4] || '00').padStart(2, '0')}`;
        return `${days} ${opens}-${closes}`;
    }).filter(Boolean);

    if (entries.length === 0) return '';
    return entries.length === 1 ? entries[0] : entries;
}

function hasOfficialIdentity(config) {
    const name = cleanText(config?.general?.name).toLowerCase();
    const location = getLocation(config);
    const placeholderName = !name || name === 'barber premium' || name === 'barber';
    const usesDefaultLocation = /sao paulo|são paulo/i.test(location.locality)
        && /av\.? paulista,? 1000/i.test(location.address);
    const placeholderLocation = !location.locality || !location.address || usesDefaultLocation;
    return !placeholderName && !placeholderLocation;
}

function deriveSeo(config, origin, options = {}) {
    const seo = config?.seo || {};
    const general = config?.general || {};
    const location = getLocation(config);
    const name = cleanText(general.name) || 'Barbearia';
    const services = Array.isArray(config?.services)
        ? config.services.map(service => cleanText(service?.name)).filter(Boolean)
        : [];
    const configuredCanonical = safeUrl(seo.canonical_url, origin);
    const canonical = configuredCanonical || safeUrl('/', origin);
    const fallbackTitle = location.label
        ? `${name} | Barbearia em ${location.label}`
        : (name === 'Barbearia' ? 'Barbearia | Atendimento e estilo masculino' : `${name} | Barbearia`);
    const servicesText = services.slice(0, 3).join(', ');
    const fallbackDescription = location.label
        ? `${name} em ${location.label}. ${servicesText ? `${servicesText}. ` : ''}Agende seu horario pelo WhatsApp.`
        : `${name}. Cortes masculinos, barba e atendimento especializado. Agende seu horario pelo WhatsApp.`;
    const title = cleanText(seo.title) || truncate(fallbackTitle, 65);
    const description = cleanText(seo.description) || truncate(fallbackDescription, 160);
    const socialTitle = cleanText(seo.social_title) || title;
    const socialDescription = cleanText(seo.social_description) || description;
    const socialImage = safeUrl(
        cleanText(seo.social_image_url) || cleanText(config?.hero?.bg_image) || cleanText(general.logo_url),
        canonical
    );
    const canonicalMatchesOrigin = Boolean(configuredCanonical)
        && new URL(configuredCanonical).origin === new URL(origin).origin;
    const blockedByRobots = isSiteBlocked(resolveRobotsText(config, ''));
    const indexable = options.hasRemoteConfig === true
        && hasOfficialIdentity(config)
        && canonicalMatchesOrigin
        && !blockedByRobots;
    const robots = indexable
        ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
        : 'noindex,follow';
    const sameAs = [general.instagram_url, general.facebook_url]
        .map(url => safeUrl(cleanText(url), canonical))
        .filter(Boolean);
    const openingHours = parseOpeningHours(config?.location?.hours);
    const telephone = cleanText(general.whatsapp);
    const business = {
        '@context': 'https://schema.org',
        '@type': 'HairSalon',
        '@id': `${canonical}#business`,
        name,
        url: canonical,
        description,
        ...(socialImage ? { image: socialImage } : {}),
        ...(telephone ? { telephone } : {}),
        ...(location.address ? {
            address: {
                '@type': 'PostalAddress',
                streetAddress: location.address,
                addressLocality: location.locality,
                addressRegion: location.region,
                postalCode: location.postalCode,
                addressCountry: 'BR'
            }
        } : {}),
        ...(openingHours ? { openingHours } : {}),
        ...(sameAs.length ? { sameAs } : {}),
        ...(services.length ? {
            hasOfferCatalog: {
                '@type': 'OfferCatalog',
                name: 'Servicos',
                itemListElement: services.map(serviceName => ({
                    '@type': 'Offer',
                    itemOffered: {
                        '@type': 'Service',
                        name: serviceName
                    }
                }))
            }
        } : {})
    };

    return {
        title,
        description,
        canonical,
        socialTitle,
        socialDescription,
        socialImage,
        robots,
        indexable,
        business
    };
}

function serializeJsonLd(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function renderSeoHead(seo) {
    const imageTags = seo.socialImage ? [
        `    <meta id="og-image-tag" property="og:image" content="${escapeHtml(seo.socialImage)}" />`,
        `    <meta id="og-image-alt-tag" property="og:image:alt" content="${escapeHtml(seo.socialTitle)}" />`,
        `    <meta id="twitter-image-tag" name="twitter:image" content="${escapeHtml(seo.socialImage)}" />`
    ].join('\n') : '';

    return [
        '    <!-- SEO_DYNAMIC_START -->',
        `    <title id="site-title-tag">${escapeHtml(seo.title)}</title>`,
        `    <meta id="meta-description-tag" name="description" content="${escapeHtml(seo.description)}" />`,
        `    <meta id="meta-robots-tag" name="robots" content="${escapeHtml(seo.robots)}" />`,
        `    <link id="canonical-tag" rel="canonical" href="${escapeHtml(seo.canonical)}" />`,
        `    <meta id="og-title-tag" property="og:title" content="${escapeHtml(seo.socialTitle)}" />`,
        `    <meta id="og-description-tag" property="og:description" content="${escapeHtml(seo.socialDescription)}" />`,
        '    <meta property="og:type" content="website" />',
        `    <meta id="og-url-tag" property="og:url" content="${escapeHtml(seo.canonical)}" />`,
        '    <meta property="og:locale" content="pt_BR" />',
        '    <meta name="twitter:card" content="summary_large_image" />',
        `    <meta id="twitter-title-tag" name="twitter:title" content="${escapeHtml(seo.socialTitle)}" />`,
        `    <meta id="twitter-description-tag" name="twitter:description" content="${escapeHtml(seo.socialDescription)}" />`,
        imageTags,
        `    <script id="local-business-jsonld" type="application/ld+json">${serializeJsonLd(seo.business)}</script>`,
        '    <!-- SEO_DYNAMIC_END -->'
    ].filter(Boolean).join('\n');
}

function injectSeoHead(html, seo) {
    if (!SEO_BLOCK_PATTERN.test(html)) {
        throw new Error('Bloco SEO dinamico nao encontrado no index.html.');
    }
    return html.replace(SEO_BLOCK_PATTERN, renderSeoHead(seo).trim());
}

function replaceTextById(html, id, value) {
    const text = cleanText(value);
    if (!text) return html;
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(<([a-z][a-z0-9]*)[^>]*\\bid="${escapedId}"[^>]*>)[\\s\\S]*?(<\\/\\2>)`, 'i');
    return html.replace(pattern, (_match, opening, _tag, closing) => `${opening}${escapeHtml(text)}${closing}`);
}

function injectCriticalContent(html, config) {
    if (!config) return html;
    const replacements = {
        'nav-site-name': cleanText(config.general?.name).toUpperCase(),
        'footer-site-name': config.general?.name,
        'hero-title': config.hero?.title,
        'hero-subtitle': config.hero?.subtitle,
        'about-section-title': config.about?.section_title,
        'about-section-subtitle': config.about?.section_subtitle,
        'problem-title': config.about?.problem_title,
        'solution-title': config.about?.solution_title,
        'services-section-title': config.services_section?.title,
        'services-section-subtitle': config.services_section?.subtitle,
        'location-sec-title': config.location?.title,
        'location-sec-desc': config.location?.desc,
        'loc-address': config.location?.address,
        'loc-hours': config.location?.hours
    };

    if (Array.isArray(config.services)) {
        config.services.slice(0, 3).forEach((service, index) => {
            replacements[`serv-${index}-name`] = service?.name;
            replacements[`serv-${index}-desc`] = service?.desc;
        });
    }

    return Object.entries(replacements).reduce(
        (result, [id, value]) => replaceTextById(result, id, value),
        html
    );
}

module.exports = {
    deriveSeo,
    escapeHtml,
    escapeXml,
    getLocation,
    hasOfficialIdentity,
    injectCriticalContent,
    injectSeoHead,
    parseOpeningHours,
    renderSeoHead,
    safeUrl
};
