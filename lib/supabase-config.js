function getSupabaseCredentials() {
    return {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
        configId: process.env.SUPABASE_CONFIG_ID || 'barber_config'
    };
}

async function loadRemoteConfig(signal) {
    const { url, key, configId } = getSupabaseCredentials();

    if (!url || !key) {
        return { available: false, config: null };
    }

    const response = await fetch(
        `${url}/rest/v1/configuracoes?id=eq.${encodeURIComponent(configId)}&select=dados`,
        {
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`
            },
            signal
        }
    );

    if (!response.ok) {
        throw new Error(`Supabase respondeu com status ${response.status}.`);
    }

    const rows = await response.json();
    return {
        available: true,
        config: rows?.[0]?.dados || null
    };
}

module.exports = {
    getSupabaseCredentials,
    loadRemoteConfig
};
