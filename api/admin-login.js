const { createAdminSession, isValidAdminPassword } = require('../lib/admin-auth');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ success: false, error: 'Método não permitido.' });
    }

    const { password } = req.body || {};
    if (!isValidAdminPassword(password)) {
        return res.status(403).json({ success: false, error: 'Credenciais inválidas.' });
    }

    try {
        return res.status(200).json({
            success: true,
            token: createAdminSession(),
            expires_in: 8 * 60 * 60
        });
    } catch (error) {
        console.error('Erro ao criar sessão administrativa:', error);
        return res.status(500).json({ success: false, error: 'Não foi possível iniciar a sessão administrativa.' });
    }
};
