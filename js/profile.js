document.addEventListener('DOMContentLoaded', async () => {
    await initDB();

    const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));

    if (!currentUser) {
        document.body.innerHTML = '<h1 style="text-align:center;padding:50px;">Acesso Negado. Faça o login.</h1>';
        return;
    }

    // Elementos da UI
    const avatarInitials = document.getElementById('avatar-initials');
    const profileName = document.getElementById('profile-name');
    const profileRoleBadge = document.getElementById('profile-role-badge');
    const profileMemberSince = document.getElementById('profile-member-since');
    const profileInfoGrid = document.getElementById('profile-info-grid');
    const statsContainer = document.getElementById('player-stats-container');
    const historyContainer = document.getElementById('match-history-list');

    async function loadProfile() {
        try {
            const allMatches = await getAllMatches();
            const endedMatches = allMatches.filter(m => m.status === 'ENCERRADA');
            const playerMatches = endedMatches.filter(m =>
                m.players.some(p => p.username === currentUser.username)
            );

            // Buscar total de gols no placar ao vivo
            let totalGols = 0;
            const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
            if (client) {
                try {
                    const { data: liveMatches } = await client.from('fm_partidas_ao_vivo').select('gols_registrados');
                    if (liveMatches) {
                        liveMatches.forEach(match => {
                            if (match.gols_registrados) {
                                const golsT1 = match.gols_registrados.time1 || [];
                                const golsT2 = match.gols_registrados.time2 || [];
                                const todosGols = [...golsT1, ...golsT2];
                                todosGols.forEach(gol => {
                                    if (gol.jogador && gol.jogador.trim().toLowerCase() === currentUser.username.toLowerCase()) {
                                        totalGols++;
                                    }
                                });
                            }
                        });
                    }
                } catch(e) {
                    console.error("Erro ao buscar gols:", e);
                }
            }

            renderHeroCard(playerMatches);
            renderPersonalInfo();
            renderStats(playerMatches, allMatches, totalGols);
            renderHistory(playerMatches);

        } catch (error) {
            console.error("Erro ao carregar perfil:", error);
            profileName.textContent = currentUser.username || 'Jogador';
        }
    }

    function renderHeroCard(matches) {
        // Iniciais do avatar
        const name = currentUser.full_name || currentUser.username || 'J';
        const initials = name.split(' ')
            .filter(w => w.length > 0)
            .map(w => w[0].toUpperCase())
            .slice(0, 2)
            .join('');
        avatarInitials.textContent = initials;

        // Nome
        profileName.textContent = currentUser.username || 'Jogador';

        // Badge de role
        const isAdmin = currentUser.role === 'admin';
        profileRoleBadge.textContent = isAdmin ? '⚡ Administrador' : '⚽ Jogador';
        if (isAdmin) profileRoleBadge.classList.add('admin');

        // Membro desde
        const firstDate = getFirstMatchDate(matches);
        if (firstDate !== 'N/A') {
            profileMemberSince.textContent = `Membro desde ${firstDate}`;
        } else {
            profileMemberSince.textContent = 'Novo membro do grupo';
        }
    }

    function renderPersonalInfo() {
        const infoItems = [
            { emoji: '👤', label: 'Nome Completo', value: currentUser.full_name || '—' },
            { emoji: '🏷️', label: 'Apelido', value: currentUser.username || '—' },
            { emoji: '📧', label: 'E-mail', value: currentUser.email || '—' },
            { emoji: '📱', label: 'Celular', value: formatPhone(currentUser.phone) || 'Não informado' }
        ];

        profileInfoGrid.innerHTML = infoItems.map(item => `
            <div class="profile-info-row">
                <span class="profile-info-label">
                    <span class="info-emoji">${item.emoji}</span>
                    ${item.label}
                </span>
                <span class="profile-info-value">${item.value}</span>
            </div>
        `).join('');
    }

    function renderStats(playerMatches, allMatches, totalGols) {
        statsContainer.innerHTML = '';

        const bestPlayerWins = countTrophies(playerMatches, 'best_player');
        const worstPlayerWins = countTrophies(playerMatches, 'worst_player');
        const paymentRate = calculatePaymentRate(playerMatches);

        const stats = [
            { icon: '⭐', iconClass: 'star', title: 'Craque da Partida', value: `${bestPlayerWins} ${bestPlayerWins === 1 ? 'vez' : 'vezes'}` },
            { icon: '⚽', iconClass: 'goal', title: 'Gols Marcados', value: `${totalGols} ${totalGols === 1 ? 'gol' : 'gols'}` },
            { icon: '🪵', iconClass: 'wood', title: 'Perna de Pau', value: `${worstPlayerWins} ${worstPlayerWins === 1 ? 'vez' : 'vezes'}` },
            { icon: '✅', iconClass: 'check', title: 'Pagamentos em Dia', value: `${paymentRate}%` },
            { icon: '🏃‍♂️', iconClass: 'matches', title: 'Partidas Jogadas', value: `${playerMatches.length}` }
        ];

        stats.forEach(stat => {
            const card = document.createElement('div');
            card.className = 'stat-card';
            card.innerHTML = `
                <div class="stat-icon ${stat.iconClass}">${stat.icon}</div>
                <div class="stat-text">
                    <p class="stat-title">${stat.title}</p>
                    <p class="stat-value">${stat.value}</p>
                </div>
            `;
            statsContainer.appendChild(card);
        });
    }

    function renderHistory(matches) {
        historyContainer.innerHTML = '';
        if (matches.length === 0) {
            historyContainer.innerHTML = '<p>Você ainda não participou de nenhuma partida encerrada.</p>';
            return;
        }

        const recentMatches = matches.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

        recentMatches.forEach(match => {
            const [year, month, day] = match.date.split('-');
            const formattedDate = `${day}/${month}/${year}`;
            const playerInMatch = match.players.find(p => p.username === currentUser.username);
            const isPaid = playerInMatch && playerInMatch.paid;

            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div class="history-item-main">
                    <span class="history-location">📍 ${match.location}</span>
                    <span class="history-date">🗓️ ${formattedDate} às ${match.time || '—'}h</span>
                </div>
                <div class="history-item-status">
                    <span class="${isPaid ? 'paid' : 'unpaid'}">
                        ${isPaid ? '✅ Pago' : '❌ Pendente'}
                    </span>
                </div>
            `;
            historyContainer.appendChild(historyItem);
        });
    }

    // --- FUNÇÕES AUXILIARES ---
    function getFirstMatchDate(matches) {
        if (matches.length === 0) return 'N/A';
        const firstMatch = matches.sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        const [year, month, day] = firstMatch.date.split('-');
        return `${day}/${month}/${year}`;
    }

    function countTrophies(matches, category) {
        let count = 0;
        matches.forEach(match => {
            const votes = match.votes?.[category];
            if (!votes || votes.length === 0) return;
            const voteCounts = votes.reduce((acc, vote) => {
                acc[vote.candidate] = (acc[vote.candidate] || 0) + 1;
                return acc;
            }, {});
            const sortedVotes = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
            if (sortedVotes.length > 0 && sortedVotes[0][0] === currentUser.username) {
                count++;
            }
        });
        return count;
    }

    function calculatePaymentRate(matches) {
        if (matches.length === 0) return 100;
        const paidMatches = matches.filter(m => {
            const player = m.players.find(p => p.username === currentUser.username);
            return player && player.paid;
        }).length;
        return Math.round((paidMatches / matches.length) * 100);
    }

    function formatPhone(phone) {
        if (!phone) return null;
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11) {
            return `(${cleaned.slice(0,2)}) ${cleaned.slice(2,7)}-${cleaned.slice(7)}`;
        }
        if (cleaned.length === 13 && cleaned.startsWith('55')) {
            const local = cleaned.slice(2);
            return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`;
        }
        return phone;
    }

    loadProfile();
});
