// ===== PLACAR AO VIVO - ESPECTADOR PÚBLICO =====
// Sincronização em tempo real com administração
// Sem autenticação - acesso público

class PlacarEspectadorPublico {
    constructor() {
        this.partidaAtual = null;
        this.cronometroInterval = null;
        this.init();
    }

    init() {
        this.bindUI();
        this.carregarDadosIniciais();
        this.setupRealtimeListeners();
    }

    bindUI() {
        this.ui = {
            statusBadge: document.getElementById('pav-status'),
            cronometro: document.getElementById('pav-cronometro'),
            nomeTime1: document.getElementById('pav-nome-time1'),
            nomeTime2: document.getElementById('pav-nome-time2'),
            placarTime1: document.getElementById('pav-placar-time1'),
            placarTime2: document.getElementById('pav-placar-time2'),
            placarCard: document.getElementById('pav-placar-card'),
            golsTime1: document.getElementById('pav-gols-time1'),
            golsTime2: document.getElementById('pav-gols-time2'),
            cartoesTime1: document.getElementById('pav-cartoes-time1'),
            cartoesTime2: document.getElementById('pav-cartoes-time2'),
            eventsSection: document.getElementById('pav-events'),
            cartoesSection: document.getElementById('pav-cartoes-section'),
            historicoLista: document.getElementById('pav-historico-lista'),
            historicoSelect: document.getElementById('pav-historico-select'),
            noMatchMsg: document.getElementById('pav-no-match'),
            matchContent: document.getElementById('pav-match-content'),

            // Classificação (Standings)
            standingsSection: document.getElementById('pav-standings-section'),
            standingsSelect: document.getElementById('pav-standings-select'),
            standingsContainer: document.getElementById('pav-standings-container'),
        };
    }

    async carregarDadosIniciais() {
        const client = this.getClient();
        if (!client) return;

        const { data: partida, error } = await client
            .from('fm_partidas_ao_vivo')
            .select('*')
            .eq('status', 'em-andamento')
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error('Erro ao carregar partida:', error);
        }

        const placarAntigoT1 = this.partidaAtual?.time1_gols ?? 0;
        const placarAntigoT2 = this.partidaAtual?.time2_gols ?? 0;

        this.partidaAtual = partida;
        this.atualizarInterface(placarAntigoT1, placarAntigoT2);
        this.carregarHistorico();
        this.carregarCompeticoesStandings();
    }

    atualizarInterface(placarAntigoT1 = 0, placarAntigoT2 = 0) {
        if (!this.partidaAtual) {
            this.ui.noMatchMsg.style.display = 'block';
            this.ui.matchContent.style.display = 'none';
            this.ui.statusBadge.className = 'pav-status-badge waiting';
            this.ui.statusBadge.innerHTML = '<span class="pav-status-dot"></span> AGUARDANDO PARTIDA';
            this.ui.cronometro.textContent = '00:00';
            return;
        }

        this.ui.noMatchMsg.style.display = 'none';
        this.ui.matchContent.style.display = 'block';

        const p = this.partidaAtual;

        this.ui.nomeTime1.textContent = p.time1_nome || 'Time 1';
        this.ui.nomeTime2.textContent = p.time2_nome || 'Time 2';

        // Aplica estilo pill com cor de fundo nos nomes
        const cor1 = p.time1_color || '#60a5fa';
        const cor2 = p.time2_color || '#fb7185';
        this.ui.nomeTime1.style.cssText = `background:${cor1};color:#fff;padding:4px 12px;border-radius:20px;text-shadow:0 1px 2px rgba(0,0,0,0.3);font-weight:700;`;
        this.ui.nomeTime2.style.cssText = `background:${cor2};color:#fff;padding:4px 12px;border-radius:20px;text-shadow:0 1px 2px rgba(0,0,0,0.3);font-weight:700;`;

        const gols1 = p.time1_gols || 0;
        const gols2 = p.time2_gols || 0;
        this.ui.placarTime1.textContent = gols1;
        this.ui.placarTime2.textContent = gols2;

        if (p.cronometro_state?.rodando) {
            this.ui.statusBadge.className = 'pav-status-badge live';
            this.ui.statusBadge.innerHTML = '<span class="pav-status-dot"></span> AO VIVO';
        } else {
            this.ui.statusBadge.className = 'pav-status-badge waiting';
            this.ui.statusBadge.innerHTML = '<span class="pav-status-dot"></span> PAUSADO';
        }

        if (gols1 > placarAntigoT1) {
            this.animarGol(this.ui.placarTime1);
        }
        if (gols2 > placarAntigoT2) {
            this.animarGol(this.ui.placarTime2);
        }

        this.gerenciarCronometro();
        this.renderEventos();
    }

    animarGol(el) {
        el.classList.add('pav-gol-animation');
        this.ui.placarCard.classList.add('gol-flash');
        setTimeout(() => {
            el.classList.remove('pav-gol-animation');
            this.ui.placarCard.classList.remove('gol-flash');
        }, 800);
    }

    gerenciarCronometro() {
        clearInterval(this.cronometroInterval);
        if (!this.partidaAtual?.cronometro_state) return;

        let { minutos, segundos, rodando } = this.partidaAtual.cronometro_state;
        this.exibirCronometro(minutos, segundos);

        if (rodando) {
            this.cronometroInterval = setInterval(() => {
                if (segundos > 0) {
                    segundos--;
                } else if (minutos > 0) {
                    minutos--;
                    segundos = 59;
                } else {
                    clearInterval(this.cronometroInterval);
                    return;
                }
                this.exibirCronometro(minutos, segundos);
            }, 1000);
        }
    }

    exibirCronometro(min, seg) {
        this.ui.cronometro.textContent =
            `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
    }

    renderEventos() {
        if (!this.partidaAtual) return;

        const gols = this.partidaAtual.gols_registrados || { time1: [], time2: [] };
        const cartoesVermelhos = this.partidaAtual.cartoes_vermelhos_registrados || { time1: [], time2: [] };
        const cartoesAmarelos = this.partidaAtual.cartoes_amarelos_registrados || { time1: [], time2: [] };

        // Gols
        const temGols = (gols.time1?.length > 0 || gols.time2?.length > 0);
        this.ui.eventsSection.style.display = temGols ? 'block' : 'none';

        if (temGols) {
            this.ui.golsTime1.innerHTML = (gols.time1 || []).map(g =>
                `<div class="pav-event-item">
                    <span class="pav-event-time">${g.minuto}</span>
                    <span>⚽</span>
                    <span class="pav-event-name">${g.jogador}</span>
                </div>`
            ).join('') || '<div class="pav-event-item" style="color:var(--pav-text-muted)">—</div>';

            this.ui.golsTime2.innerHTML = (gols.time2 || []).map(g =>
                `<div class="pav-event-item">
                    <span class="pav-event-time">${g.minuto}</span>
                    <span>⚽</span>
                    <span class="pav-event-name">${g.jogador}</span>
                </div>`
            ).join('') || '<div class="pav-event-item" style="color:var(--pav-text-muted)">—</div>';
        }

        // Cartões (amarelos + vermelhos)
        const todosCartoesT1 = [
            ...(cartoesVermelhos.time1 || []).map(c => ({ ...c, tipo: 'vermelho' })),
            ...(cartoesAmarelos.time1 || []).map(c => ({ ...c, tipo: 'amarelo' }))
        ];
        const todosCartoesT2 = [
            ...(cartoesVermelhos.time2 || []).map(c => ({ ...c, tipo: 'vermelho' })),
            ...(cartoesAmarelos.time2 || []).map(c => ({ ...c, tipo: 'amarelo' }))
        ];

        const temCartoes = (todosCartoesT1.length > 0 || todosCartoesT2.length > 0);
        this.ui.cartoesSection.style.display = temCartoes ? 'block' : 'none';

        if (temCartoes) {
            this.ui.cartoesTime1.innerHTML = todosCartoesT1.map(c =>
                `<div class="pav-event-item cartao">
                    <span class="pav-event-time">${c.minuto}</span>
                    <span>${c.tipo === 'vermelho' ? '🟥' : '🟨'}</span>
                    <span class="pav-event-name">${c.jogador}</span>
                </div>`
            ).join('') || '';

            this.ui.cartoesTime2.innerHTML = todosCartoesT2.map(c =>
                `<div class="pav-event-item cartao">
                    <span class="pav-event-time">${c.minuto}</span>
                    <span>${c.tipo === 'vermelho' ? '🟥' : '🟨'}</span>
                    <span class="pav-event-name">${c.jogador}</span>
                </div>`
            ).join('') || '';
        }
    }

    // === HISTÓRICO COM DROPDOWN ===
    async carregarHistorico() {
        const client = this.getClient();
        if (!client || !this.ui.historicoSelect) return;

        const { data, error } = await client
            .from('fm_partidas_ao_vivo')
            .select('id, match_id, time1_nome, time2_nome, updated_at')
            .eq('status', 'finalizada')
            .order('updated_at', { ascending: false })
            .limit(50);

        if (error || !data || data.length === 0) {
            this.ui.historicoSelect.innerHTML = '<option value="">— Nenhuma partida finalizada —</option>';
            this.ui.historicoLista.innerHTML = '<p class="pav-empty-message">Nenhuma partida finalizada ainda.</p>';
            return;
        }

        const competicaoMap = new Map();
        const matchIds = [];

        for (const p of data) {
            const compId = p.match_id || p.id;
            if (!competicaoMap.has(compId)) {
                competicaoMap.set(compId, {
                    id: compId,
                    matchId: p.match_id,
                    partidas: [],
                    title: null
                });
                if (p.match_id) matchIds.push(p.match_id);
            }
            competicaoMap.get(compId).partidas.push(p);
        }

        if (matchIds.length > 0) {
            const { data: matches } = await client
                .from('fm_matches')
                .select('id, title')
                .in('id', [...new Set(matchIds)]);

            if (matches) {
                for (const m of matches) {
                    if (competicaoMap.has(m.id)) {
                        competicaoMap.get(m.id).title = m.title;
                    }
                }
            }
        }

        this.ui.historicoSelect.innerHTML = '<option value="">— Escolha uma competição —</option>';
        for (const [compId, comp] of competicaoMap) {
            const title = comp.title || `${comp.partidas[0].time1_nome} vs ${comp.partidas[0].time2_nome}`;
            const option = document.createElement('option');
            option.value = compId;
            option.textContent = `${title} (${comp.partidas.length} partida${comp.partidas.length > 1 ? 's' : ''})`;
            this.ui.historicoSelect.appendChild(option);
        }

        this.ui.historicoSelect.addEventListener('change', () => {
            const selectedId = this.ui.historicoSelect.value;
            if (selectedId) {
                this.carregarHistoricoDetalhado(selectedId);
            } else {
                this.ui.historicoLista.innerHTML = '<p class="pav-empty-message">Selecione uma competição para ver o histórico detalhado.</p>';
            }
        });
    }

    async carregarHistoricoDetalhado(competicaoId) {
        const client = this.getClient();
        if (!client || !this.ui.historicoLista) return;

        let query = client
            .from('fm_partidas_ao_vivo')
            .select('*')
            .eq('status', 'finalizada')
            .order('updated_at', { ascending: false })
            .limit(20);

        if (competicaoId.length === 36 && competicaoId.includes('-')) {
            query = query.eq('id', competicaoId);
        } else {
            query = query.eq('match_id', competicaoId);
        }

        const { data, error } = await query;

        if (error || !data || data.length === 0) {
            this.ui.historicoLista.innerHTML = '<p class="pav-empty-message">Nenhuma partida encontrada.</p>';
            return;
        }

        let competicaoTitulo = '';
        const matchId = data[0].match_id;
        if (matchId) {
            const { data: match } = await client
                .from('fm_matches')
                .select('title')
                .eq('id', matchId)
                .maybeSingle();
            if (match?.title) competicaoTitulo = match.title;
        }

        this.renderHistoricoDetalhado(data, competicaoTitulo);
    }

    renderHistoricoDetalhado(partidas, competicaoTitulo) {
        if (!this.ui.historicoLista) return;

        let html = '';

        if (competicaoTitulo) {
            html += `
                <div style="text-align:center;margin-bottom:20px;padding:12px;background:rgba(245,158,11,0.08);border-radius:12px;border:1px solid rgba(245,158,11,0.15);">
                    <i class="fas fa-trophy" style="color:#f59e0b;margin-right:6px;"></i>
                    <strong style="font-size:1rem;">${this.escapeHtml(competicaoTitulo)}</strong>
                </div>`;
        }

        partidas.forEach((p) => {
            const dataObj = new Date(p.updated_at);
            const dataFormatada = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const horaFormatada = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const bg1 = p.time1_color || '#60a5fa';
            const bg2 = p.time2_color || '#fb7185';
            const win1 = p.time1_gols > p.time2_gols;
            const win2 = p.time2_gols > p.time1_gols;
            const empate = p.time1_gols === p.time2_gols;

            const gols = p.gols_registrados || { time1: [], time2: [] };
            const golsT1 = gols.time1 || [];
            const golsT2 = gols.time2 || [];

            const agruparGols = (lista) => {
                const map = new Map();
                lista.forEach(g => {
                    const key = g.jogador;
                    if (!map.has(key)) map.set(key, { jogador: key, gols: 0, minutos: [] });
                    const entry = map.get(key);
                    entry.gols++;
                    entry.minutos.push(g.minuto);
                });
                return [...map.values()];
            };

            const artilheirosT1 = agruparGols(golsT1);
            const artilheirosT2 = agruparGols(golsT2);

            const renderArtilheiros = (lista, bgColor) => {
                if (lista.length === 0) return '<span style="color:var(--pav-text-muted);font-size:0.78rem;">—</span>';
                return lista.map(a => `
                    <div style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px;padding:3px 8px;background:${bgColor};color:#fff;border-radius:12px;font-size:0.72rem;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.3);">
                        ⚽ ${a.gols}x ${this.escapeHtml(a.jogador)}
                        <span style="opacity:0.7;font-weight:400;">(${a.minutos.join(', ')})</span>
                    </div>
                `).join('');
            };

            const cartoesVerm = p.cartoes_vermelhos_registrados || { time1: [], time2: [] };
            const cartoesAm = p.cartoes_amarelos_registrados || { time1: [], time2: [] };

            const renderCartoes = (timeKey) => {
                const verm = (cartoesVerm[timeKey] || []).map(c => `<span style="display:inline-flex;align-items:center;gap:2px;margin:1px 3px;font-size:0.7rem;">🟥 ${this.escapeHtml(c.jogador)} (${c.minuto})</span>`).join('');
                const am = (cartoesAm[timeKey] || []).map(c => `<span style="display:inline-flex;align-items:center;gap:2px;margin:1px 3px;font-size:0.7rem;">🟨 ${this.escapeHtml(c.jogador)} (${c.minuto})</span>`).join('');
                return verm + am || '<span style="color:var(--pav-text-muted);font-size:0.7rem;">Nenhum</span>';
            };

            let resultadoBadge = '';
            if (empate) {
                resultadoBadge = '<span style="background:rgba(251,191,36,0.15);color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;">EMPATE</span>';
            }

            html += `
                <div class="pav-historico-item">
                    <div class="pav-historico-date-badge">
                        <i class="far fa-calendar-alt"></i> ${dataFormatada} <span class="time-muted">${horaFormatada}</span>
                        ${resultadoBadge}
                    </div>
                    <div class="pav-historico-match">
                        <div class="pav-historico-team left ${win1 ? 'winner' : ''}" style="background:${bg1};color:#fff;border-radius:20px;padding:4px 10px;text-shadow:0 1px 2px rgba(0,0,0,0.3);">
                            <span class="team-name">${this.escapeHtml(p.time1_nome)}</span>
                        </div>
                        <div class="pav-historico-score-box">
                            <span class="score-badge s1 ${win1 ? 'winner' : ''}" style="color:${win1 ? bg1 : 'var(--pav-text-secondary)'}">${p.time1_gols}</span>
                            <span class="sep">×</span>
                            <span class="score-badge s2 ${win2 ? 'winner' : ''}" style="color:${win2 ? bg2 : 'var(--pav-text-secondary)'}">${p.time2_gols}</span>
                        </div>
                        <div class="pav-historico-team right ${win2 ? 'winner' : ''}" style="background:${bg2};color:#fff;border-radius:20px;padding:4px 10px;text-shadow:0 1px 2px rgba(0,0,0,0.3);">
                            <span class="team-name">${this.escapeHtml(p.time2_nome)}</span>
                        </div>
                    </div>

                    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--pav-text-muted);text-transform:uppercase;margin-bottom:6px;">
                                    ⚽ Gols - ${this.escapeHtml(p.time1_nome)}
                                </div>
                                ${renderArtilheiros(artilheirosT1, bg1)}
                            </div>
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--pav-text-muted);text-transform:uppercase;margin-bottom:6px;">
                                    ⚽ Gols - ${this.escapeHtml(p.time2_nome)}
                                </div>
                                ${renderArtilheiros(artilheirosT2, bg2)}
                            </div>
                        </div>
                    </div>

                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--pav-text-muted);text-transform:uppercase;margin-bottom:4px;">
                                    🟨🟥 Cartões - ${this.escapeHtml(p.time1_nome)}
                                </div>
                                ${renderCartoes('time1')}
                            </div>
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--pav-text-muted);text-transform:uppercase;margin-bottom:4px;">
                                    🟨🟥 Cartões - ${this.escapeHtml(p.time2_nome)}
                                </div>
                                ${renderCartoes('time2')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        this.ui.historicoLista.innerHTML = html;
    }


    // === CLASSIFICAÇÃO (STANDINGS) ===
    async carregarCompeticoesStandings() {
        const client = this.getClient();
        if (!client || !this.ui.standingsSelect) return;

        const { data, error } = await client
            .from('fm_standings')
            .select('match_id')
            .order('updated_at', { ascending: false });

        if (error || !data) {
            this.ui.standingsSelect.innerHTML = '<option value="">— Nenhuma competição —</option>';
            return;
        }

        const matchIds = [...new Set(data.map(d => d.match_id))];
        const matchTitles = {};

        if (matchIds.length > 0) {
            const { data: matches } = await client
                .from('fm_matches')
                .select('id, title, date')
                .in('id', matchIds);

            if (matches) {
                matches.forEach(m => {
                    matchTitles[m.id] = m.title || `Partida ${m.date || m.id}`;
                });
            }

            const missingIds = matchIds.filter(id => !matchTitles[id]);
            if (missingIds.length > 0) {
                const { data: liveMatches } = await client
                    .from('fm_partidas_ao_vivo')
                    .select('id, time1_nome, time2_nome')
                    .in('id', missingIds);

                if (liveMatches) {
                    liveMatches.forEach(m => {
                        matchTitles[m.id] = `${m.time1_nome} vs ${m.time2_nome}`;
                    });
                }
            }
        }

        this.ui.standingsSelect.innerHTML = '<option value="">— Escolha uma competição —</option>';
        matchIds.forEach(id => {
            const title = matchTitles[id] || id;
            const option = document.createElement('option');
            option.value = id;
            option.textContent = title;
            this.ui.standingsSelect.appendChild(option);
        });

        this.ui.standingsSelect.addEventListener('change', () => {
            const selectedId = this.ui.standingsSelect.value;
            if (selectedId) {
                this.carregarStandings(selectedId);
            } else {
                this.ui.standingsContainer.innerHTML = '<p class="pav-empty-message">Selecione uma competição para ver a classificação.</p>';
            }
        });
    }

    async carregarStandings(matchId) {
        const client = this.getClient();
        if (!client || !this.ui.standingsContainer) return;

        const { data, error } = await client
            .from('fm_standings')
            .select('*')
            .eq('match_id', matchId)
            .order('points', { ascending: false })
            .order('wins', { ascending: false })
            .order('goal_difference', { ascending: false })
            .order('goals_for', { ascending: false })
            .order('goals_against', { ascending: true });

        if (error || !data || data.length === 0) {
            this.ui.standingsContainer.innerHTML = '<p class="pav-empty-message">Nenhuma classificação disponível.</p>';
            return;
        }

        this.renderStandingsTable(data);
    }

    renderStandingsTable(standings) {
        if (!this.ui.standingsContainer) return;

        const formatGD = (gd) => {
            if (gd > 0) return `<span class="standings-gd-positive">+${gd}</span>`;
            if (gd < 0) return `<span class="standings-gd-negative">${gd}</span>`;
            return `<span class="standings-gd-zero">0</span>`;
        };

        const rows = standings.map((s, i) => {
            const pos = i + 1;
            const rowClass = pos === 1 ? 'top-1' : '';
            const bg = s.team_color || '#60a5fa';

            return `
                <tr class="${rowClass}">
                    <td>${pos}º</td>
                    <td><span class="standings-team-pill" style="background:${bg}">${this.escapeHtml(s.team_name)}</span></td>
                    <td><span class="standings-pts">${s.points}</span></td>
                    <td>${s.matches_played || 0}</td>
                    <td>${s.wins || 0}</td>
                    <td>${s.draws || 0}</td>
                    <td>${s.losses || 0}</td>
                    <td>${s.goals_for || 0}</td>
                    <td>${s.goals_against || 0}</td>
                    <td>${formatGD(s.goal_difference || 0)}</td>
                </tr>`;
        }).join('');

        this.ui.standingsContainer.innerHTML = `
            <div class="pav-standings-table-wrap">
                <table class="pav-standings-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Time</th>
                            <th>P</th>
                            <th>J</th>
                            <th>V</th>
                            <th>E</th>
                            <th>D</th>
                            <th>GP</th>
                            <th>GC</th>
                            <th>SG</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>`;
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    setupRealtimeListeners() {
        const client = this.getClient();
        if (!client) return;

        client.channel('fm-placar-publico')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'fm_partidas_ao_vivo' },
                (payload) => {
                    console.log('[Placar Público] Atualização recebida:', payload.eventType);
                    
                    if (!this.partidaAtual) {
                        // Se não tinha partida, recarrega
                        this.carregarDadosIniciais();
                        return;
                    }

                    // Se é a partida sendo visualizada, sincroniza
                    if (payload.new.id === this.partidaAtual.id) {
                        const placarMudou = this.partidaAtual.time1_gols !== payload.new.time1_gols || 
                                          this.partidaAtual.time2_gols !== payload.new.time2_gols;
                        
                        this.partidaAtual = payload.new;
                        
                        // Renderiza a interface com animação de gol se placar mudou
                        this.atualizarInterface(
                            payload.old?.time1_gols ?? 0,
                            payload.old?.time2_gols ?? 0
                        );
                    } else if (payload.new.status === 'finalizada' && this.partidaAtual.status === 'em-andamento') {
                        // Partida acabou, recarrega para pegar nova partida se houver
                        this.carregarDadosIniciais();
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'fm_partidas_ao_vivo' },
                (payload) => {
                    // Nova partida iniciada
                    if (!this.partidaAtual && payload.new.status === 'em-andamento') {
                        this.carregarDadosIniciais();
                    }
                }
            )
            .subscribe();

        // Canal para standings (atualiza em tempo real)
        client.channel('fm-standings-publico')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'fm_standings' },
                () => {
                    this.carregarCompeticoesStandings();
                }
            )
            .subscribe();
    }

    getClient() {
        if (typeof window !== 'undefined' && window.supabaseClient) {
            return window.supabaseClient;
        }
        if (typeof window !== 'undefined' && window.supabase?.createClient) {
            // Fallback: cria cliente com as credenciais do database.js
            return null;
        }
        return null;
    }
}

// Inicializa quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    // Garante que o Supabase client do database.js esteja disponível
    if (typeof getSupabaseClient === 'function') {
        getSupabaseClient(); // Inicializa e expõe como window.supabaseClient
    }
    new PlacarEspectadorPublico();
});
