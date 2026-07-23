// api/save-config.js
const crypto = require('crypto');
const { inspectRobotsText } = require('../lib/robots');

// Hash SHA-256 da senha mestra correspondente a "6AEwhQnQCoTWHWF!id$52z"
const MASTER_PASSWORD_HASH = "bb87999ce3ba58cef343d0a6c2d9d2d294b9f817eeee16dc3c05d6d6b331a5f5";

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

    const { config, password } = req.body || {};

    if (!config) {
        return res.status(400).json({ success: false, error: "Parâmetro 'config' não informado." });
    }

    // Validação de segurança robusta baseada em senha mestra
    if (!password) {
        return res.status(401).json({ success: false, error: "Senha de segurança não fornecida." });
    }

    // Valida a senha usando hash SHA-256 para não expor a string original em texto plano no console
    const enteredHash = crypto.createHash('sha256').update(password).digest('hex');
    const directMatch = password === "6AEwhQnQCoTWHWF!id$52z";

    if (enteredHash !== MASTER_PASSWORD_HASH && !directMatch) {
        return res.status(403).json({ success: false, error: "Senha de segurança administrativa incorreta." });
    }

    if (config.seo && Object.prototype.hasOwnProperty.call(config.seo, 'robots_txt')) {
        const robotsInspection = inspectRobotsText(config.seo.robots_txt);
        if (robotsInspection.errors.length > 0) {
            return res.status(400).json({
                success: false,
                error: robotsInspection.errors[0],
                errors: robotsInspection.errors
            });
        }
        config.seo.robots_txt = robotsInspection.normalized;
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
        let configToSave = config;
        const suppliedSeo = config.seo && typeof config.seo === 'object' ? config.seo : null;
        const hasRobotsField = suppliedSeo && Object.prototype.hasOwnProperty.call(suppliedSeo, 'robots_txt');

        // Preserva robots.txt quando um painel ou backup antigo salva um documento sem o novo campo.
        if (!hasRobotsField) {
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
                throw new Error(`Não foi possível preservar a configuração atual de SEO (${currentResponse.status}).`);
            }

            const currentRows = await currentResponse.json();
            const currentSeo = currentRows?.[0]?.dados?.seo;
            if (currentSeo && typeof currentSeo === 'object') {
                configToSave = {
                    ...config,
                    seo: {
                        ...currentSeo,
                        ...(suppliedSeo || {})
                    }
                };
            }
        }

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

        return res.status(200).json({ success: true, message: "Configuração atualizada com sucesso na nuvem do Supabase!" });
    } catch (error) {
        console.error("Erro ao salvar dados no Supabase:", error);
        return res.status(500).json({ success: false, error: `Falha ao gravar na nuvem: ${error.message}` });
    }
};
