// api/get-config.js
module.exports = async (req, res) => {
    // Adiciona cabeçalhos de CORS básicos para compatibilidade
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Variáveis de ambiente padrão injetadas pelo Supabase na Vercel
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const configId = process.env.SUPABASE_CONFIG_ID || 'barber_config';

    // Se o Supabase não estiver configurado na Vercel, a API informa de forma amigável
    if (!supabaseUrl || !supabaseKey) {
        return res.status(200).json({ 
            success: false, 
            error: "A integração do Supabase não está conectada ao projeto no painel da Vercel. Usando configurações locais padrão.",
            config: null 
        });
    }

    try {
        // Faz a requisição REST HTTP nativa para o Supabase (PostgREST)
        // Busca o campo 'dados' da tabela 'configuracoes' onde 'id' é igual ao configId exclusivo
        const response = await fetch(`${supabaseUrl}/rest/v1/configuracoes?id=eq.${encodeURIComponent(configId)}&select=dados`, {
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`Erro na API do Supabase (${response.status}): ${response.statusText}`);
        }

        const data = await response.json();
        
        // Se a consulta retornar dados válidos e a linha com as configurações existir
        if (data && data.length > 0 && data[0].dados) {
            return res.status(200).json({ success: true, config: data[0].dados });
        } else {
            // Se o banco estiver vazio ou o registro ainda não tiver sido criado
            return res.status(200).json({ success: true, config: null, info: "Nenhuma configuração encontrada no Supabase." });
        }
    } catch (error) {
        console.error("Erro ao ler dados do Supabase:", error);
        return res.status(500).json({ success: false, error: `Falha na sincronização remota: ${error.message}` });
    }
};
