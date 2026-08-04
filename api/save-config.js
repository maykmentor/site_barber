// api/save-config.js
const { inspectRobotsText } = require('../lib/robots');
const { isAuthorizedAdminRequest } = require('../lib/admin-auth');
const { SOCIAL_IMAGE_BUCKET, getManagedSocialImagePath } = require('../lib/social-image-storage');

function mergeStoredConfig(currentConfig, submittedConfig, normalizedRobotsText, flags = {}) {
    const suppliedSeo = submittedConfig.seo && typeof submittedConfig.seo === 'object' ? submittedConfig.seo : {};
    const suppliedRobots = submittedConfig.robots && typeof submittedConfig.robots === 'object' ? submittedConfig.robots : {};
    const mergedSeo = {
        ...(currentConfig.seo || {}),
        ...suppliedSeo
    };
    const mergedRobots = {
        ...(currentConfig.robots || {}),
        ...suppliedRobots
    };

    if (flags.hasModernRobots || flags.hasLegacyRobots) {
        mergedRobots.txt = normalizedRobotsText;
    }
    if (flags.hasModernRobots) {
        delete mergedSeo.robots_txt;
    } else if (flags.hasLegacyRobots) {
        mergedSeo.robots_txt = normalizedRobotsText;
    }

    return {
        ...submittedConfig,
        seo: mergedSeo,
        robots: mergedRobots
    };
}

async function deletePreviousSocialImage(previousUrl, nextUrl, supabaseUrl, serviceRoleKey, configId) {
    if (!serviceRoleKey || previousUrl === nextUrl) return;
    const objectPath = getManagedSocialImagePath(previousUrl, supabaseUrl, configId);
    if (!objectPath) return;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${SOCIAL_IMAGE_BUCKET}`, {
        method: 'DELETE',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [objectPath] })
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Não foi possível remover a imagem social anterior (${response.status}).`);
    }
}

module.exports = async (req, res) => {
    // Adiciona cabeçalhos de CORS básicos
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Responde ao preflight do CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: "Método não permitido." });
    }

    const { config } = req.body || {};

    if (!isAuthorizedAdminRequest(req)) {
        return res.status(401).json({ success: false, error: 'Sessão administrativa inválida ou expirada.' });
    }

    if (!config) {
        return res.status(400).json({ success: false, error: "Parâmetro 'config' não informado." });
    }

    const suppliedSeo = config.seo && typeof config.seo === 'object' ? config.seo : {};
    const suppliedRobots = config.robots && typeof config.robots === 'object' ? config.robots : {};
    const hasModernRobots = Object.prototype.hasOwnProperty.call(suppliedRobots, 'txt');
    const hasLegacyRobots = Object.prototype.hasOwnProperty.call(suppliedSeo, 'robots_txt');
    const suppliedRobotsText = hasModernRobots ? suppliedRobots.txt : suppliedSeo.robots_txt;
    let normalizedRobotsText;

    if (hasModernRobots || hasLegacyRobots) {
        const robotsInspection = inspectRobotsText(suppliedRobotsText);
        if (robotsInspection.errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: robotsInspection.errors[0],
                errors: robotsInspection.errors
            });
        }
        normalizedRobotsText = robotsInspection.normalized;
    }

    // Variáveis de ambiente padrão injetadas pelo Supabase na Vercel
    const supabaseUrl = process.env.SUPABASE_URL;
    // Damos preferência à service_role para contornar RLS de gravação, senão usamos a anon
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const configId = process.env.SUPABASE_CONFIG_ID || 'barber_config';

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ 
            success: false, 
            error: "A integração do Supabase não está conectada ao projeto. Não é possível salvar alterações em nuvem." 
        });
    }

    try {
        const currentResponse = await fetch(
            `${supabaseUrl}/rest/v1/configuracoes?id=eq.${encodeURIComponent(configId)}&select=dados`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`
                }
            }
        );

        if (!currentResponse.ok) {
            throw new Error(`Não foi possível preservar a configuração atual (${currentResponse.status}).`);
        }

        const currentRows = await currentResponse.json();
        const currentConfig = currentRows?.[0]?.dados || {};
        const configToSave = mergeStoredConfig(currentConfig, config, normalizedRobotsText, {
            hasModernRobots,
            hasLegacyRobots
        });

        // Envia os dados para a API REST do Supabase para realizar um UPSERT nativo no banco
        // Para fazer UPSERT no Supabase/PostgREST enviamos um POST com a chave primária 'id'
        // e incluímos o header 'Prefer: resolution=merge-duplicates'
        const response = await fetch(`${supabaseUrl}/rest/v1/configuracoes`, {
            method: 'POST',
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                id: configId,
                dados: configToSave
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Erro na gravação do Supabase (${response.status}): ${errText}`);
        }

        try {
            await deletePreviousSocialImage(
                currentConfig?.seo?.social_image_url,
                configToSave?.seo?.social_image_url,
                supabaseUrl,
                process.env.SUPABASE_SERVICE_ROLE_KEY,
                configId
            );
        } catch (cleanupError) {
            console.error('Erro ao limpar imagem social anterior:', cleanupError);
        }

        return res.status(200).json({ success: true, message: "Configuração atualizada com sucesso na nuvem do Supabase!" });
    } catch (error) {
        console.error("Erro ao salvar dados no Supabase:", error);
        return res.status(500).json({ success: false, error: `Falha ao gravar na nuvem: ${error.message}` });
    }
};

module.exports.mergeStoredConfig = mergeStoredConfig;
module.exports.deletePreviousSocialImage = deletePreviousSocialImage;
module.exports.getManagedSocialImagePath = getManagedSocialImagePath;
