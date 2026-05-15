const STORAGE_KEYS = {
    config: 'fm_config',
    users: 'fm_users',
    matches: 'fm_matches',
    playerStats: 'fm_player_stats',
    activityLog: 'fm_activity_log'
};

// Usa configuração centralizada (js/config.js)
const SUPABASE_URL = window.FM_CONFIG?.supabase?.url || '';
const SUPABASE_PUBLISHABLE_KEY = window.FM_CONFIG?.supabase?.publishableKey || '';

let futebolSupabaseClient = null;
let supabaseUnavailable = false;

// Valores padrão vazios - os valores reais vêm do banco (fm_app_config)
const DEFAULT_CONFIG = [];

function readStorage(key, fallback = []) {
    const raw = localStorage.getItem(key);
    if (!raw) {
        return Array.isArray(fallback) ? [...fallback] : fallback;
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`Falha ao ler storage ${key}:`, error);
        return Array.isArray(fallback) ? [...fallback] : fallback;
    }
}

function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function generateId(prefix = 'item') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

const TEAM_DEFAULT_STYLES = [
    { color: '#ef4444', icon: '⚽' },
    { color: '#3b82f6', icon: '🔵' },
    { color: '#1c1c2e', icon: '⚫' },
    { color: '#10b981', icon: '🟢' },
    { color: '#f59e0b', icon: '⭐' },
    { color: '#8b5cf6', icon: '🟣' },
    { color: '#f97316', icon: '🟠' },
    { color: '#06b6d4', icon: '🔷' },
    { color: '#ec4899', icon: '💗' },
    { color: '#84cc16', icon: '✨' }
];

function normalizeTeamKey(value) {
    return String(value || '').trim().toLowerCase();
}

function createTeamId(name, index = 0) {
    const slug = normalizeTeamKey(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug ? `team_${slug}` : generateId(`team_${index + 1}`);
}

function normalizeTeams(teams) {
    if (!Array.isArray(teams)) return [];

    const seenIds = new Set();
    return teams
        .map((team, index) => {
            const source = typeof team === 'string' ? { name: team } : (team || {});
            const name = String(source.name || source.nome || '').trim();
            if (!name) return null;

            let id = String(source.id || createTeamId(name, index)).trim();
            if (seenIds.has(id)) {
                id = `${id}_${index + 1}`;
            }
            seenIds.add(id);

            const position = index + 1;
            const defaultStyle = TEAM_DEFAULT_STYLES[(position - 1) % TEAM_DEFAULT_STYLES.length];

            return {
                id,
                name,
                position,
                color: source.color || defaultStyle.color,
                icon: source.icon || defaultStyle.icon
            };
        })
        .filter(Boolean);
}

function normalizeTeamDraws(draws) {
    return draws && typeof draws === 'object' && !Array.isArray(draws) ? draws : {};
}

function getCurrentStoredUser() {
    try {
        return JSON.parse(sessionStorage.getItem('currentUser') || 'null');
    } catch (error) {
        return null;
    }
}

function isCurrentUserAdmin() {
    return getCurrentStoredUser()?.role === 'admin';
}

function assertAdminWrite(action = 'alterar dados') {
    if (!isCurrentUserAdmin()) {
        throw new Error(`Apenas administradores podem ${action}.`);
    }
}

function getSupabaseClient() {
    if (supabaseUnavailable || typeof window === 'undefined' || !window.supabase?.createClient) {
        return null;
    }

    if (!futebolSupabaseClient) {
        futebolSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        window.supabaseClient = futebolSupabaseClient; // Expose globally for auth and scripts
    }

    return futebolSupabaseClient;
}

async function runSupabaseQuery(operation, fallbackValue) {
    const client = getSupabaseClient();
    if (!client) return fallbackValue;

    try {
        return await operation(client);
    } catch (error) {
        console.warn('Supabase indisponivel, usando fallback local:', error);
        supabaseUnavailable = true;
        return fallbackValue;
    }
}

function normalizeMatchFromSupabase(row) {
    if (!row) return null;

    return {
        id: row.id,
        title: row.title || '',
        date: row.date,
        time: row.time,
        location: row.location,
        playerFee: Number(row.player_fee || 0),
        notes: row.notes || '',
        status: row.status || 'AGENDADA',
        players: row.players || [],
        teams: normalizeTeams(row.teams || []),
        teamDraws: normalizeTeamDraws(row.team_draws || {}),
        votes: row.votes || { best_player: [], worst_player: [] },
        financial_summary: row.financial_summary || { expenses: [] },
        results_processed: Boolean(row.results_processed),
        voting_deadline: row.voting_deadline
    };
}

function normalizeMatchToSupabase(match) {
    return {
        id: match.id,
        title: match.title || '',
        date: match.date,
        time: match.time,
        location: match.location,
        player_fee: Number(match.playerFee || match.player_fee || 0),
        notes: match.notes || '',
        status: match.status || 'AGENDADA',
        players: match.players || [],
        teams: normalizeTeams(match.teams || []),
        team_draws: normalizeTeamDraws(match.teamDraws || match.team_draws || {}),
        votes: match.votes || { best_player: [], worst_player: [] },
        financial_summary: match.financial_summary || { expenses: [] },
        results_processed: Boolean(match.results_processed),
        voting_deadline: match.voting_deadline || null
    };
}

async function initDB() {
    if (typeof window === 'undefined') {
        throw new Error('localStorage so funciona no browser.');
    }

    if (!localStorage.getItem(STORAGE_KEYS.config)) {
        writeStorage(STORAGE_KEYS.config, DEFAULT_CONFIG);
    }
    if (!localStorage.getItem(STORAGE_KEYS.users)) {
        writeStorage(STORAGE_KEYS.users, []);
    }
    if (!localStorage.getItem(STORAGE_KEYS.matches)) {
        writeStorage(STORAGE_KEYS.matches, []);
    }
    if (!localStorage.getItem(STORAGE_KEYS.playerStats)) {
        writeStorage(STORAGE_KEYS.playerStats, []);
    }
    if (!localStorage.getItem(STORAGE_KEYS.activityLog)) {
        writeStorage(STORAGE_KEYS.activityLog, []);
    }
}

async function populateInitialData() {
    await initDB();
}

async function getConfig(key) {
    await initDB();

    const remoteValue = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_app_config')
            .select('value')
            .eq('key', key)
            .maybeSingle();

        if (error) throw error;
        return data?.value || null;
    }, undefined);

    if (remoteValue !== undefined) return remoteValue;

    const config = readStorage(STORAGE_KEYS.config, DEFAULT_CONFIG);
    const entry = config.find(item => item.key === key);
    return entry ? entry.value : null;
}

async function getUser(username) {
    await initDB();

    const remoteUser = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_profiles')
            .select('*')
            .ilike('username', username)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }, undefined);

    if (remoteUser !== undefined) return remoteUser;

    const users = readStorage(STORAGE_KEYS.users, []);
    return users.find(user => user.username.toLowerCase() === username.toLowerCase()) || null;
}

async function getUserByEmail(email) {
    await initDB();

    const remoteUser = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_profiles')
            .select('*')
            .ilike('email', email)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }, undefined);

    if (remoteUser !== undefined) return remoteUser;

    const users = readStorage(STORAGE_KEYS.users, []);
    return users.find(user => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function getProfileByAuthId(authId) {
    await initDB();

    const remoteUser = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_profiles')
            .select('*')
            .eq('auth_id', authId)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }, undefined);

    if (remoteUser !== undefined) return remoteUser;

    const users = readStorage(STORAGE_KEYS.users, []);
    return users.find(user => user.id === authId || user.auth_id === authId) || null;
}

async function addUser(user) {
    await initDB();
    assertAdminWrite('adicionar usuarios');

    const remoteUser = await runSupabaseQuery(async (client) => {
        const payload = {
            username: user.username,
            full_name: user.full_name || user.fullName || user.username,
            email: user.email || null,
            role: user.role || 'player',
            auth_id: user.auth_id || user.id || null
        };
        const { data, error } = await client
            .from('fm_profiles')
            .upsert(payload, { onConflict: 'username' })
            .select()
            .single();

        if (error) throw error;
        return data;
    }, undefined);

    if (remoteUser !== undefined) return remoteUser;

    const users = readStorage(STORAGE_KEYS.users, []);
    if (!user.id) {
        user.id = generateId('user');
    }
    user.created_at = user.created_at || new Date().toISOString();
    user.updated_at = new Date().toISOString();

    users.push(user);
    writeStorage(STORAGE_KEYS.users, users);
    return user;
}

async function getAllMatches() {
    await initDB();

    const remoteMatches = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_matches')
            .select('*')
            .order('date', { ascending: true })
            .order('time', { ascending: true });

        if (error) throw error;
        return (data || []).map(normalizeMatchFromSupabase);
    }, undefined);

    if (remoteMatches !== undefined) return remoteMatches;

    return readStorage(STORAGE_KEYS.matches, []);
}

async function addMatch(match) {
    await initDB();
    assertAdminWrite('salvar partidas');

    const remoteMatch = await runSupabaseQuery(async (client) => {
        const payload = normalizeMatchToSupabase(match);
        const { data, error } = await client
            .from('fm_matches')
            .upsert(payload, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;
        return normalizeMatchFromSupabase(data);
    }, undefined);

    if (remoteMatch !== undefined) return remoteMatch;

    const matches = readStorage(STORAGE_KEYS.matches, []);
    const existingIndex = matches.findIndex(item => item.id === match.id);

    match.updated_at = new Date().toISOString();
    if (!match.id) {
        match.id = generateId('match');
    }

    if (existingIndex !== -1) {
        matches[existingIndex] = { ...matches[existingIndex], ...match };
    } else {
        matches.push(match);
    }

    writeStorage(STORAGE_KEYS.matches, matches);
    return match;
}

async function updateMatchRoster(match, action = 'alterar lista de jogadores') {
    await initDB();
    assertAdminWrite(action);

    const payload = normalizeMatchToSupabase(match);
    const client = getSupabaseClient();

    if (client && !supabaseUnavailable) {
        try {
            const { error } = await client.rpc('admin_update_match_roster', {
                match_id: payload.id,
                new_players: payload.players,
                new_votes: payload.votes,
                new_team_draws: payload.team_draws
            });

            if (error) throw error;
            return true;
        } catch (error) {
            const message = error?.message || '';
            const rpcMissing = message.includes('Could not find the function')
                || message.includes('admin_update_match_roster');
            const canFallbackLocal = message.includes('Failed to fetch')
                || error?.name === 'TypeError';

            if (rpcMissing) {
                console.warn('RPC administrativa de jogadores indisponivel, tentando salvar partida completa:', error);
                return await addMatch(match);
            }

            if (!canFallbackLocal) {
                throw error;
            }

            console.warn('Supabase indisponivel, usando fallback local para lista de jogadores:', error);
            supabaseUnavailable = true;
        }
    }

    return await addMatch(match);
}

async function releasePlayerDraw(matchId, username) {
    await initDB();
    assertAdminWrite('liberar novo sorteio');

    const usernameKey = normalizeTeamKey(username);
    const client = getSupabaseClient();

    if (client && !supabaseUnavailable) {
        try {
            const { error } = await client.rpc('admin_release_player_draw', {
                p_match_id: matchId,
                p_player_username: username,
                p_release_reason: 'Administrador liberou novo sorteio.'
            });

            if (error) throw error;
            return true;
        } catch (error) {
            const message = error?.message || '';
            const canFallback = message.includes('Could not find the function')
                || message.includes('admin_release_player_draw')
                || message.includes('Failed to fetch')
                || error?.name === 'TypeError';

            if (!canFallback) {
                throw error;
            }

            console.warn('RPC de liberacao de sorteio indisponivel, usando fallback local:', error);
            supabaseUnavailable = true;
        }
    }

    // Fallback local (apenas quando Supabase totalmente offline)
    const matches = readStorage(STORAGE_KEYS.matches, []);
    const match = matches.find(item => item.id === matchId);
    if (!match) {
        throw new Error('Partida nao encontrada.');
    }

    match.players = Array.isArray(match.players) ? match.players : [];
    const player = match.players.find(item => normalizeTeamKey(item?.username) === usernameKey);
    match.teamDraws = normalizeTeamDraws(match.teamDraws || match.team_draws || {});
    if (!player && !match.teamDraws[usernameKey]) {
        throw new Error('Jogador nao encontrado na lista de confirmados.');
    }

    if (player) {
        delete player.teamId;
        delete player.teamName;
        delete player.assignmentMode;
        delete player.drawnAt;
    }

    delete match.teamDraws[usernameKey];
    match.team_draws = match.teamDraws;
    match.updated_at = new Date().toISOString();
    writeStorage(STORAGE_KEYS.matches, matches);
    return true;
}

async function deleteMatch(matchId) {
    await initDB();
    assertAdminWrite('excluir partidas');

    const remoteDeleted = await runSupabaseQuery(async (client) => {
        const { error } = await client
            .from('fm_matches')
            .delete()
            .eq('id', matchId);

        if (error) throw error;
        return true;
    }, undefined);

    if (remoteDeleted !== undefined) return;

    let matches = readStorage(STORAGE_KEYS.matches, []);
    matches = matches.filter(match => match.id !== matchId);
    writeStorage(STORAGE_KEYS.matches, matches);
}

async function getMatchById(matchId) {
    await initDB();

    const remoteMatch = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_matches')
            .select('*')
            .eq('id', matchId)
            .maybeSingle();

        if (error) throw error;
        return normalizeMatchFromSupabase(data);
    }, undefined);

    if (remoteMatch !== undefined) return remoteMatch;

    const matches = readStorage(STORAGE_KEYS.matches, []);
    return matches.find(match => match.id === matchId) || null;
}

async function getPlayerStats(username) {
    await initDB();

    const remoteStats = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_player_stats')
            .select('*')
            .ilike('username', username)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }, undefined);

    if (remoteStats !== undefined) return remoteStats;

    const stats = readStorage(STORAGE_KEYS.playerStats, []);
    return stats.find(item => item.username.toLowerCase() === username.toLowerCase()) || null;
}

async function updatePlayerStats(stats) {
    await initDB();
    assertAdminWrite('alterar estatisticas dos jogadores');

    const remoteStats = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_player_stats')
            .upsert(stats, { onConflict: 'username' })
            .select()
            .single();

        if (error) throw error;
        return data;
    }, undefined);

    if (remoteStats !== undefined) return remoteStats;

    const allStats = readStorage(STORAGE_KEYS.playerStats, []);
    const index = allStats.findIndex(item => item.username.toLowerCase() === stats.username.toLowerCase());

    stats.updated_at = new Date().toISOString();
    if (!stats.username) {
        throw new Error('Username obrigatorio para atualizar stats.');
    }

    if (index !== -1) {
        allStats[index] = { ...allStats[index], ...stats };
    } else {
        allStats.push(stats);
    }

    writeStorage(STORAGE_KEYS.playerStats, allStats);
    return stats;
}

async function clearPlayerStats(username) {
    await initDB();
    assertAdminWrite('limpar estatisticas dos jogadores');

    const remoteCleared = await runSupabaseQuery(async (client) => {
        const { error } = await client
            .from('fm_player_stats')
            .delete()
            .ilike('username', username);

        if (error) throw error;
        return true;
    }, undefined);

    if (remoteCleared !== undefined) return;

    let allStats = readStorage(STORAGE_KEYS.playerStats, []);
    allStats = allStats.filter(item => item.username.toLowerCase() !== username.toLowerCase());
    writeStorage(STORAGE_KEYS.playerStats, allStats);
}

async function addActivityLog(log) {
    await initDB();

    const remoteLog = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_activity_logs')
            .insert({
                username: log.username,
                action: log.action || 'login'
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }, undefined);

    if (remoteLog !== undefined) return remoteLog;

    const activityLog = readStorage(STORAGE_KEYS.activityLog, []);
    const entry = {
        id: generateId('log'),
        username: log.username,
        action: log.action || 'login',
        timestamp: new Date().toISOString()
    };
    activityLog.unshift(entry);
    writeStorage(STORAGE_KEYS.activityLog, activityLog);
    return entry;
}

async function getActivityLogs(limit = 5) {
    await initDB();

    const remoteLogs = await runSupabaseQuery(async (client) => {
        const { data, error } = await client
            .from('fm_activity_logs')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    }, undefined);

    if (remoteLogs !== undefined) return remoteLogs;

    const activityLog = readStorage(STORAGE_KEYS.activityLog, []);
    return activityLog.slice(0, limit);
}

async function signOutUser() {
    const client = getSupabaseClient();
    if (client) {
        await client.auth.signOut();
    }
    sessionStorage.removeItem('currentUser');
}

async function playerUpdateMatchData(matchId, players, votes) {
    await initDB();

    const client = getSupabaseClient();
    if (client && !supabaseUnavailable) {
        try {
            const { error } = await client.rpc('player_update_match', {
                match_id: matchId,
                new_players: players,
                new_votes: votes
            });
            if (error) throw error;
            return;
        } catch (error) {
            const message = error?.message || '';
            const canFallback = message.includes('Could not find the function')
                || message.includes('Failed to fetch')
                || error?.name === 'TypeError';

            if (!canFallback) {
                throw error;
            }

            console.warn('RPC de atualizacao indisponivel, usando fallback local:', error);
            supabaseUnavailable = true;
        }
    }

    // Fallback local
    const matches = readStorage(STORAGE_KEYS.matches, []);
    const match = matches.find(m => m.id === matchId);
    if (match) {
        match.players = players;
        match.votes = votes;
        match.updated_at = new Date().toISOString();
        writeStorage(STORAGE_KEYS.matches, matches);
    }
}

/**
 * Desistência do jogador: marca como 'withdrew' sem remover da lista.
 * Somente o admin pode remover jogadores da lista de confirmados.
 * 
 * Retorna:
 * - { success: true, username, status: 'withdrew', withdrawnAt }
 */
async function playerWithdrawFromMatch(matchId, reason = '') {
    await initDB();

    const client = getSupabaseClient();
    if (!client) {
        throw new Error('Sistema indisponível. Tente novamente em instantes.');
    }

    try {
        const { data, error } = await client.rpc('player_withdraw_from_match', {
            p_match_id: matchId,
            p_reason: reason
        });

        if (error) {
            console.error('Erro na RPC de desistência:', error);
            throw new Error(error.message || 'Erro ao registrar desistência. Tente novamente.');
        }

        if (!data || !data.success) {
            throw new Error('Resposta inválida do servidor. Tente novamente.');
        }

        return data;
    } catch (error) {
        console.error('Falha ao registrar desistência:', error);
        throw error;
    }
}

function chooseBalancedTeam(match) {
    // ⚠️ DEPRECATED: O balanceamento agora é feito no backend via RPC.
    // Esta função é mantida apenas para fallback de emergência (offline total).
    const teams = normalizeTeams(match.teams || []);
    if (teams.length === 0) return null;

    const counts = teams.map(team => ({
        team,
        count: (match.players || []).filter(player => player.teamId === team.id).length
    }));
    const minCount = Math.min(...counts.map(item => item.count));
    const eligibleTeams = counts.filter(item => item.count === minCount);
    const index = Math.floor(Math.random() * eligibleTeams.length);
    return eligibleTeams[index]?.team || null;
}

/**
 * Gera uma chave de idempotência única para evitar replay de requests.
 * Baseada em: matchId + username + timestamp truncado (15s) + random
 */
function generateDrawIdempotencyKey(matchId) {
    const currentUser = getCurrentStoredUser();
    const username = currentUser?.username || 'unknown';
    const timeWindow = Math.floor(Date.now() / 15000); // janela de 15 segundos
    const random = Math.random().toString(36).substring(2, 8);
    return `draw_${matchId}_${normalizeTeamKey(username)}_${timeWindow}_${random}`;
}

/**
 * SORTEIO SEGURO: Chama a RPC no backend. NUNCA faz fallback para localStorage.
 * 
 * PROTEÇÕES:
 * - Sorteio ocorre EXCLUSIVAMENTE no backend (PostgreSQL)
 * - Idempotency key evita replay de requests
 * - Time escolhido pelo backend com balanceamento
 * - Sem fallback client-side (se falhar, o erro é propagado)
 * - Jogador recebe SEMPRE o mesmo time (registro imutável no banco)
 */
async function playerDrawTeam(matchId, forceTeamId = null) {
    await initDB();

    const client = getSupabaseClient();
    if (!client) {
        throw new Error('Sistema indisponivel. Tente novamente em instantes.');
    }

    // Gera chave de idempotência para evitar replay
    const idempotencyKey = generateDrawIdempotencyKey(matchId);

    try {
        const params = {
            p_match_id: matchId,
            p_idempotency_key: idempotencyKey
        };
        if (forceTeamId) {
            params.p_force_team_id = forceTeamId;
        }

        const { data, error } = await client.rpc('player_draw_team', params);

        if (error) {
            console.error('Erro na RPC de sorteio:', error);
            throw new Error(error.message || 'Erro ao realizar sorteio. Tente novamente.');
        }

        if (!data) {
            throw new Error('Resposta invalida do servidor. Tente novamente.');
        }

        return data;
    } catch (error) {
        const message = error?.message || '';

        // Se for "already_joined", é um erro esperado e seguro
        if (message.includes('already') || message.includes('possui')) {
            throw error;
        }

        // Erros de rede/timeout - NÃO faz fallback local, propaga o erro
        console.error('Falha crítica no sorteio (sem fallback local):', error);
        throw new Error(
            'Não foi possível realizar o sorteio. Verifique sua conexão e tente novamente. ' +
            'Seu progresso está seguro.'
        );
    }
}

/**
 * Consulta o status de sorteio do jogador no backend.
 * Usado ao carregar a página para recuperar time já sorteado.
 * 
 * Retorna:
 * - { authenticated: false } se não estiver logado
 * - { has_draw: true, team_id, team_name, ... } se já tiver time
 * - { has_draw: false } se puder sortear
 * - { has_draw: false, was_released: true } se admin liberou novo sorteio
 */
async function getPlayerDrawStatus(matchId) {
    await initDB();

    const client = getSupabaseClient();
    if (!client) {
        console.warn('Supabase indisponível, não é possível verificar status do sorteio.');
        return { authenticated: false, error: 'offline' };
    }

    try {
        const { data, error } = await client.rpc('get_player_draw_status', {
            p_match_id: matchId
        });

        if (error) {
            console.warn('Erro ao consultar status do sorteio:', error);
            return { authenticated: false, error: error.message };
        }

        return data || { authenticated: false };
    } catch (error) {
        console.warn('Erro ao consultar status do sorteio:', error);
        return { authenticated: false, error: 'network_error' };
    }
}
