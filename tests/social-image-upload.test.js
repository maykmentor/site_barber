const assert = require('node:assert/strict');
const crypto = require('crypto');
const jpeg = require('jpeg-js');
const { afterEach, test } = require('node:test');

const adminLoginHandler = require('../api/admin-login');
const uploadSocialImageHandler = require('../api/upload-social-image');
const { createAdminSession, verifyAdminSession } = require('../lib/admin-auth');

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

function createJpegDataUrl(width = 1200, height = 630) {
    const pixels = Buffer.alloc(width * height * 4, 255);
    const buffer = jpeg.encode({ data: pixels, width, height }, 70).data;
    return `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`;
}

function configureEnvironment() {
    process.env.ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('test-password').digest('hex');
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.SUPABASE_CONFIG_ID = 'site_brothers';
}

function createAuthorizedHeaders() {
    return { authorization: `Bearer ${createAdminSession()}` };
}

test('login administrativo cria sessão assinada sem devolver a senha', async () => {
    configureEnvironment();
    const res = createResponse();

    await adminLoginHandler({
        method: 'POST',
        body: { password: 'test-password' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(verifyAdminSession(res.body.token), true);
    assert.equal(Object.hasOwn(res.body, 'password'), false);
});

test('login administrativo falha fechado sem hash configurado', async () => {
    configureEnvironment();
    delete process.env.ADMIN_PASSWORD_HASH;
    const res = createResponse();

    await adminLoginHandler({
        method: 'POST',
        body: { password: 'test-password' }
    }, res);

    assert.equal(res.statusCode, 403);
});

test('upload social rejeita sessão inválida antes de acessar o Storage', async () => {
    configureEnvironment();
    let fetchCalled = false;
    global.fetch = async () => {
        fetchCalled = true;
        throw new Error('não deveria chamar');
    };
    const res = createResponse();

    await uploadSocialImageHandler({
        method: 'POST',
        headers: { authorization: 'Bearer token-inválido' },
        body: { image: createJpegDataUrl() }
    }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(fetchCalled, false);
});

test('upload social valida dimensões finais antes do Storage', async () => {
    configureEnvironment();
    const res = createResponse();

    await uploadSocialImageHandler({
        method: 'POST',
        headers: createAuthorizedHeaders(),
        body: { image: createJpegDataUrl(800, 600) }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /1200 × 630/);
});

test('upload social cria bucket público e retorna URL HTTPS', async () => {
    configureEnvironment();
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (calls.length === 1) return { ok: false, status: 404 };
        return { ok: true, status: 200, json: async () => ({}) };
    };
    const res = createResponse();

    await uploadSocialImageHandler({
        method: 'POST',
        headers: createAuthorizedHeaders(),
        body: { image: createJpegDataUrl() }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.match(res.body.url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/seo-assets\/site_brothers-[a-f0-9]{8}\/social-[a-f0-9]{16}\.jpg$/);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[2].options.method, 'POST');
    assert.equal(calls[2].options.headers['Content-Type'], 'image/jpeg');
    assert.equal(Buffer.isBuffer(calls[2].options.body), true);
});

test('upload social reconcilia bucket público com restrições divergentes', async () => {
    configureEnvironment();
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (calls.length === 1) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ public: true, file_size_limit: 1000, allowed_mime_types: [] })
            };
        }
        return { ok: true, status: 200, json: async () => ({}) };
    };
    const res = createResponse();

    await uploadSocialImageHandler({
        method: 'POST',
        headers: createAuthorizedHeaders(),
        body: { image: createJpegDataUrl() }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[2].options.method, 'POST');
});

test('parser JPEG extrai dimensões do arquivo processado', () => {
    const image = uploadSocialImageHandler.decodeImageData(createJpegDataUrl());

    assert.deepEqual(uploadSocialImageHandler.getJpegDimensions(image), { width: 1200, height: 630 });
    assert.equal(uploadSocialImageHandler.decodeImageData('data:image/png;base64,AAAA'), null);
});

test('parser JPEG rejeita arquivo truncado mesmo com marcador de dimensão', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0]);

    assert.equal(uploadSocialImageHandler.getJpegDimensions(buffer), null);
});
