const crypto = require('crypto');

const SOCIAL_IMAGE_BUCKET = 'seo-assets';

function getSocialImageDirectory(configId) {
    const value = String(configId || 'barber_config');
    const hash = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
    const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'barber-config';
    return `${slug}-${hash}`;
}

function getManagedSocialImagePath(value, supabaseUrl, configId) {
    if (typeof value !== 'string' || !value || !supabaseUrl) return '';
    try {
        const imageUrl = new URL(value);
        const projectUrl = new URL(supabaseUrl);
        const prefix = `/storage/v1/object/public/${SOCIAL_IMAGE_BUCKET}/`;
        if (imageUrl.origin !== projectUrl.origin || !imageUrl.pathname.startsWith(prefix)) return '';
        const objectPath = decodeURIComponent(imageUrl.pathname.slice(prefix.length));
        const expectedDirectory = `${getSocialImageDirectory(configId)}/`;
        return objectPath.startsWith(expectedDirectory) && !objectPath.includes('..') ? objectPath : '';
    } catch (_error) {
        return '';
    }
}

module.exports = {
    SOCIAL_IMAGE_BUCKET,
    getManagedSocialImagePath,
    getSocialImageDirectory
};
