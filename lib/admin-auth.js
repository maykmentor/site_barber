const crypto = require('crypto');

const SESSION_TTL_SECONDS = 8 * 60 * 60;

function isValidAdminPassword(password) {
    if (typeof password !== 'string' || !password) return false;
    const expectedHash = process.env.ADMIN_PASSWORD_HASH || '';
    const enteredHash = crypto.createHash('sha256').update(password).digest('hex');

    if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    return crypto.timingSafeEqual(Buffer.from(enteredHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function getSessionSecret() {
    return process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(value, secret) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createAdminSession(now = Date.now()) {
    const secret = getSessionSecret();
    if (!secret) throw new Error('Segredo de sessão administrativa não configurado.');
    const payload = Buffer.from(JSON.stringify({
        scope: 'admin',
        configId: process.env.SUPABASE_CONFIG_ID || 'barber_config',
        exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS
    })).toString('base64url');
    return `${payload}.${sign(payload, secret)}`;
}

function verifyAdminSession(token, now = Date.now()) {
    if (typeof token !== 'string' || !token.includes('.')) return false;
    const secret = getSessionSecret();
    if (!secret) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return false;
    const expected = sign(payload, secret);
    if (signature.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.scope === 'admin'
            && data.configId === (process.env.SUPABASE_CONFIG_ID || 'barber_config')
            && Number.isInteger(data.exp)
            && data.exp > Math.floor(now / 1000);
    } catch (_error) {
        return false;
    }
}

function getBearerToken(req) {
    const authorization = req.headers?.authorization || req.headers?.Authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
}

function isAuthorizedAdminRequest(req) {
    return verifyAdminSession(getBearerToken(req));
}

module.exports = {
    createAdminSession,
    getBearerToken,
    isAuthorizedAdminRequest,
    isValidAdminPassword,
    verifyAdminSession
};
