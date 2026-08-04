const crypto = require('crypto');
const jpeg = require('jpeg-js');
const { isAuthorizedAdminRequest } = require('../lib/admin-auth');
const { SOCIAL_IMAGE_BUCKET, getSocialImageDirectory } = require('../lib/social-image-storage');

const MAX_IMAGE_BYTES = 1500 * 1024;
const REQUIRED_WIDTH = 1200;
const REQUIRED_HEIGHT = 630;

function scanJpegDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;

    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;

    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = buffer[offset + 1];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0xd8 || marker === 0x01) {
            offset += 2;
            continue;
        }
        const segmentLength = buffer.readUInt16BE(offset + 2);
        if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) return null;
        if (sofMarkers.has(marker)) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7)
            };
        }
        offset += 2 + segmentLength;
    }

    return null;
}

function getJpegDimensions(buffer) {
    const scanned = scanJpegDimensions(buffer);
    if (!scanned || scanned.width !== REQUIRED_WIDTH || scanned.height !== REQUIRED_HEIGHT) return null;
    try {
        const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false });
        if (!decoded || decoded.width !== scanned.width || decoded.height !== scanned.height) return null;
        return scanned;
    } catch (_error) {
        return null;
    }
}

function decodeImageData(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return null;
    return Buffer.from(match[1], 'base64');
}

function storageHeaders(serviceRoleKey, extra = {}) {
    return {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        ...extra
    };
}

async function ensurePublicBucket(supabaseUrl, serviceRoleKey) {
    const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${SOCIAL_IMAGE_BUCKET}`;
    const response = await fetch(bucketUrl, {
        headers: storageHeaders(serviceRoleKey)
    });

    if (response.status === 404) {
        const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
            method: 'POST',
            headers: storageHeaders(serviceRoleKey, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                id: SOCIAL_IMAGE_BUCKET,
                name: SOCIAL_IMAGE_BUCKET,
                public: true,
                file_size_limit: MAX_IMAGE_BYTES,
                allowed_mime_types: ['image/jpeg']
            })
        });
        if (!createResponse.ok && createResponse.status !== 409) {
            throw new Error(`Não foi possível criar o bucket de SEO (${createResponse.status}).`);
        }
        return;
    }

    if (!response.ok) {
        throw new Error(`Não foi possível consultar o bucket de SEO (${response.status}).`);
    }

    const bucket = await response.json();
    const allowedTypes = Array.isArray(bucket.allowed_mime_types) ? bucket.allowed_mime_types : [];
    const needsUpdate = bucket.public !== true
        || Number(bucket.file_size_limit) !== MAX_IMAGE_BYTES
        || !allowedTypes.includes('image/jpeg');
    if (needsUpdate) {
        const updateResponse = await fetch(bucketUrl, {
            method: 'PUT',
            headers: storageHeaders(serviceRoleKey, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                public: true,
                file_size_limit: MAX_IMAGE_BYTES,
                allowed_mime_types: ['image/jpeg']
            })
        });
        if (!updateResponse.ok) {
            throw new Error(`Não foi possível tornar o bucket de SEO público (${updateResponse.status}).`);
        }
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const { image } = req.body || {};
    if (!isAuthorizedAdminRequest(req)) {
        return res.status(401).json({ success: false, error: 'Sessão administrativa inválida ou expirada.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const configId = process.env.SUPABASE_CONFIG_ID || 'barber_config';
    if (!supabaseUrl || !serviceRoleKey) {
        return res.status(500).json({ success: false, error: 'Supabase Storage não configurado no servidor.' });
    }

    const imageBuffer = decodeImageData(image);
    if (!imageBuffer) {
        return res.status(400).json({ success: false, error: 'Envie uma imagem JPEG válida.' });
    }
    if (imageBuffer.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ success: false, error: 'A imagem processada excede 1,5 MB.' });
    }

    const dimensions = getJpegDimensions(imageBuffer);
    if (!dimensions || dimensions.width !== REQUIRED_WIDTH || dimensions.height !== REQUIRED_HEIGHT) {
        return res.status(400).json({
            success: false,
            error: `A imagem processada deve ter exatamente ${REQUIRED_WIDTH} × ${REQUIRED_HEIGHT} px.`
        });
    }

    try {
        await ensurePublicBucket(supabaseUrl, serviceRoleKey);
        const safeConfigId = getSocialImageDirectory(configId);
        const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
        const objectPath = `${safeConfigId}/social-${hash}.jpg`;
        const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/${SOCIAL_IMAGE_BUCKET}/${objectPath}`, {
            method: 'POST',
            headers: storageHeaders(serviceRoleKey, {
                'Content-Type': 'image/jpeg',
                'cache-control': 'max-age=31536000',
                'x-upsert': 'true'
            }),
            body: imageBuffer
        });

        if (!uploadResponse.ok) {
            throw new Error(`Falha no upload para o Supabase Storage (${uploadResponse.status}).`);
        }

        const publicUrl = `${supabaseUrl}/storage/v1/object/public/${SOCIAL_IMAGE_BUCKET}/${objectPath}`;
        return res.status(200).json({
            success: true,
            url: publicUrl,
            width: REQUIRED_WIDTH,
            height: REQUIRED_HEIGHT,
            content_type: 'image/jpeg'
        });
    } catch (error) {
        console.error('Erro ao enviar imagem social:', error);
        return res.status(500).json({ success: false, error: error.message || 'Falha ao enviar imagem social.' });
    }
};

module.exports.decodeImageData = decodeImageData;
module.exports.ensurePublicBucket = ensurePublicBucket;
module.exports.getJpegDimensions = getJpegDimensions;
