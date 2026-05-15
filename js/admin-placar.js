// ===== PLACAR AO VIVO - ADMINISTRAÇÃO =====
// Sistema inteligente e responsivo de gerenciamento de placar ao vivo
// Com sincronização em tempo real e carregamento automático de dados

// Utilitário: garante que uma cor fique visível em fundo escuro
// Cores muito escuras (como preto #000000) são convertidas para branco/cinza claro
function corVisivel(hex) {
    if (!hex || typeof hex !== 'string') return '#e2e8f0';
    const h = hex.replace('#', '');
    if (h.length < 6) return hex;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    // Luminância relativa
    const lum = (0.299 * r + 0.587 * g + 0.114 * b);
    // Se a cor for muito escura, retorna branco
    if (lum < 60) return '#e2e8f0';
    return hex;
}

class PlacarAdmin {
    constructor() {
        this.partidaAtual = null;
        this.matchCadastrada = null;
        this.cronometroInterval = null;
        this.autocompleteCache = { time1: [], time2: [] };
        this.init();
    }

    init() {
        this.bindUI();
        this.setupEventListeners();
        this.carregarDadosIniciais();
        this.setupRealtimeListeners();
    }

    getClient() {
        if (window.supabaseClient) return window.supabaseClient;
        if (typeof getSupabaseClient === 'function') return getSupabaseClient();
        return null;
    }

    bindUI() {
        this.ui = {
            // Config e Seleção de Partida
            configSection: document.getElementById('adm-config'),
            selectMatch: document.getElementById('adm-select-match'),
            matchInfo: document.getElementById('adm-match-info'),
            selectTime1: document.getElementById('adm-time1-select'),
            selectTime2: document.getElementById('adm-time2-select'),
            inputTime1Nome: document.getElementById('adm-time1-nome'),
            inputTime2Nome: document.getElementById('adm-time2-nome'),
            btnIniciar: document.getElementById('adm-btn-iniciar'),

            // Partida ao vivo
            liveSection: document.getElementById('adm-live'),
            statusBadge: document.getElementById('adm-status'),
            cronometro: document.getElementById('adm-cronometro'),
            btnPlayPause: document.getElementById('adm-btn-play-pause'),
            btnReset: document.getElementById('adm-btn-reset'),

            // Período
            periodoBtn1T: document.getElementById('adm-periodo-1t'),
            periodoBtn2T: document.getElementById('adm-periodo-2t'),
            periodoBtnPR: document.getElementById('adm-periodo-pr'),

            // Placar
            nomeTime1: document.getElementById('adm-nome-time1'),
            nomeTime2: document.getElementById('adm-nome-time2'),
            placarTime1: document.getElementById('adm-placar-time1'),
            placarTime2: document.getElementById('adm-placar-time2'),
            btnPlusT1: document.getElementById('adm-plus-t1'),
            btnMinusT1: document.getElementById('adm-minus-t1'),
            btnPlusT2: document.getElementById('adm-plus-t2'),
            btnMinusT2: document.getElementById('adm-minus-t2'),

            // Escalação
            escalacaoSection: document.getElementById('adm-escalacao-section'),
            escalacaoT1: document.getElementById('adm-escalacao-t1'),
            escalacaoT2: document.getElementById('adm-escalacao-t2'),
            btnAddJogadorManual: document.getElementById('adm-btn-add-jogador-manual'),

            // Gols
            inputGolT1: document.getElementById('adm-gol-jogador-t1'),
            inputGolT2: document.getElementById('adm-gol-jogador-t2'),
            suggestGolT1: document.getElementById('adm-gol-suggest-t1'),
            suggestGolT2: document.getElementById('adm-gol-suggest-t2'),
            btnGolT1: document.getElementById('adm-btn-gol-t1'),
            btnGolT2: document.getElementById('adm-btn-gol-t2'),
            listaGolsT1: document.getElementById('adm-gols-t1'),
            listaGolsT2: document.getElementById('adm-gols-t2'),

            // Cartões
            inputCartaoT1: document.getElementById('adm-cartao-jogador-t1'),
            inputCartaoT2: document.getElementById('adm-cartao-jogador-t2'),
            suggestCartaoT1: document.getElementById('adm-cartao-suggest-t1'),
            suggestCartaoT2: document.getElementById('adm-cartao-suggest-t2'),
            btnCartaoAmareloT1: document.getElementById('adm-btn-cartao-amarelo-t1'),
            btnCartaoAmarelT2: document.getElementById('adm-btn-cartao-amarelo-t2'),
            btnCartaoVermT1: document.getElementById('adm-btn-cartao-vermelho-t1'),
            btnCartaoVermT2: document.getElementById('adm-btn-cartao-vermelho-t2'),
            listaCartoesT1: document.getElementById('adm-cartoes-t1'),
            listaCartoesT2: document.getElementById('adm-cartoes-t2'),

            // Substituições
            inputSubSaiT1: document.getElementById('adm-sub-sai-t1'),
            inputSubSaiT2: document.getElementById('adm-sub-sai-t2'),
            inputSubEntraT1: document.getElementById('adm-sub-entra-t1'),
            inputSubEntraT2: document.getElementById('adm-sub-entra-t2'),
            btnSubT1: document.getElementById('adm-btn-sub-t1'),
            btnSubT2: document.getElementById('adm-btn-sub-t2'),
            listaSubstituicoes: document.getElementById('adm-substituicoes-lista'),

            // Eventos Personalizados
            inputEvento: document.getElementById('adm-evento-texto'),
            btnEvento: document.getElementById('adm-btn-evento'),
            listaEventos: document.getElementById('adm-eventos-lista'),

            // Observações
            observacoes: document.getElementById('adm-observacoes'),
            btnSalvarObs: document.getElementById('adm-btn-salvar-obs'),

            // Finalizar
            btnFinalizar: document.getElementById('adm-btn-finalizar'),

            // Histórico
            historicoLista: document.getElementById('adm-historico-lista'),
            historicoSelect: document.getElementById('adm-historico-select'),

            // Classificação (Standings)
            standingsSection: document.getElementById('adm-standings-section'),
            standingsSelect: document.getElementById('adm-standings-select'),
            standingsContainer: document.getElementById('adm-standings-container'),

            // Modal de Jogador
            modalJogador: document.getElementById('adm-modal-jogador'),
            modalNome: document.getElementById('adm-modal-jogador-nome'),
            modalTime: document.getElementById('adm-modal-jogador-time'),
            modalConfirmar: document.getElementById('adm-modal-jogador-confirmar'),
            modalClose: document.getElementById('adm-modal-close'),
        };
    }

    setupEventListeners() {
        // Seleção de partida
        if (this.ui.selectMatch) {
            this.ui.selectMatch.addEventListener('change', () => this.selecionarPartidaCadastrada());
        }

        // Toggle de input manual para times
        const handleTeamSelect = (selectEl, inputEl) => {
            if (!selectEl) return;
            if (selectEl.value === 'manual') {
                inputEl.style.display = 'block';
                inputEl.required = true;
            } else {
                inputEl.style.display = 'none';
                inputEl.required = false;
            }
        };

        if (this.ui.selectTime1) {
            this.ui.selectTime1.addEventListener('change', (e) => handleTeamSelect(e.target, this.ui.inputTime1Nome));
        }
        if (this.ui.selectTime2) {
            this.ui.selectTime2.addEventListener('change', (e) => handleTeamSelect(e.target, this.ui.inputTime2Nome));
        }

        // Iniciar partida
        this.ui.btnIniciar.addEventListener('click', () => this.iniciarPartida());

        // Período
        this.ui.periodoBtn1T?.addEventListener('click', () => this.mudarPeriodo('1T'));
        this.ui.periodoBtn2T?.addEventListener('click', () => this.mudarPeriodo('2T'));
        this.ui.periodoBtnPR?.addEventListener('click', () => this.mudarPeriodo('PR'));

        // Cronômetro
        this.ui.btnPlayPause.addEventListener('click', () => this.toggleCronometro());
        this.ui.btnReset.addEventListener('click', () => this.resetCronometro());

        // Placar
        this.ui.btnPlusT1.addEventListener('click', () => this.ajustarPlacar('time1', 1));
        this.ui.btnMinusT1.addEventListener('click', () => this.ajustarPlacar('time1', -1));
        this.ui.btnPlusT2.addEventListener('click', () => this.ajustarPlacar('time2', 1));
        this.ui.btnMinusT2.addEventListener('click', () => this.ajustarPlacar('time2', -1));

        // Gols com autocomplete
        this.ui.inputGolT1?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time1', 'gol'));
        this.ui.inputGolT2?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time2', 'gol'));
        this.ui.btnGolT1.addEventListener('click', () => this.registrarGol('time1'));
        this.ui.btnGolT2.addEventListener('click', () => this.registrarGol('time2'));

        // Cartões com autocomplete
        this.ui.inputCartaoT1?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time1', 'cartao'));
        this.ui.inputCartaoT2?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time2', 'cartao'));
        this.ui.btnCartaoAmareloT1?.addEventListener('click', () => this.registrarCartao('time1', 'amarelo'));
        this.ui.btnCartaoAmarelT2?.addEventListener('click', () => this.registrarCartao('time2', 'amarelo'));
        this.ui.btnCartaoVermT1?.addEventListener('click', () => this.registrarCartao('time1', 'vermelho'));
        this.ui.btnCartaoVermT2?.addEventListener('click', () => this.registrarCartao('time2', 'vermelho'));

        // Substituições
        this.ui.inputSubSaiT1?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time1', 'sub'));
        this.ui.inputSubSaiT2?.addEventListener('input', (e) => this.mostrarSugestoes(e, 'time2', 'sub'));
        this.ui.btnSubT1?.addEventListener('click', () => this.registrarSubstituicao('time1'));
        this.ui.btnSubT2?.addEventListener('click', () => this.registrarSubstituicao('time2'));

        // Eventos Personalizados
        this.ui.btnEvento?.addEventListener('click', () => this.adicionarEvento());
        this.ui.inputEvento?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.adicionarEvento();
        });

        // Observações
        this.ui.btnSalvarObs?.addEventListener('click', () => this.salvarObservacoes());

        // Jogador Manual
        this.ui.btnAddJogadorManual?.addEventListener('click', () => this.abrirModalJogador());
        this.ui.modalClose?.addEventListener('click', () => this.fecharModalJogador());
        this.ui.modalConfirmar?.addEventListener('click', () => this.confirmarJogadorManual());

        // Finalizar
        this.ui.btnFinalizar.addEventListener('click', () => this.finalizarPartida());
    }

    async carregarDadosIniciais() {
        const client = this.getClient();
        if (!client) return;

        // Carrega partida em andamento
        const { data: emAndamento, error } = await client
            .from('fm_partidas_ao_vivo')
            .select('*')
            .eq('status', 'em-andamento')
            .maybeSingle();

        if (emAndamento) {
            this.partidaAtual = emAndamento;
            // Carrega dados da partida cadastrada se vinculada
            if (this.partidaAtual.match_id) {
                await this.carregarPartidaCadastrada(this.partidaAtual.match_id);
            }
            this.mostrarLive();
        } else {
            this.mostrarConfig();
            await this.carregarPartidasCadastradas();
        }

        this.carregarHistorico();
        this.carregarCompeticoesStandings();
    }

    async carregarPartidasCadastradas() {
        const client = this.getClient();
        if (!client || !this.ui.selectMatch) return;

        const { data, error } = await client
            .from('fm_matches')
            .select('id,title,date,time,teams')
            .order('date', { ascending: false })
            .limit(20);

        if (error || !data) {
            this.ui.selectMatch.innerHTML = '<option value="">— Partida manual (sem vínculo) —</option>';
            return;
        }

        this.ui.selectMatch.innerHTML = '<option value="">— Partida manual (sem vínculo) —</option>';
        data.forEach(match => {
            const titleDisplay = match.title ? `${match.title}` : 'Sem título';
            const option = document.createElement('option');
            option.value = match.id;
            option.textContent = `${titleDisplay} - ${match.date}`;
            this.ui.selectMatch.appendChild(option);
        });
    }

    async selecionarPartidaCadastrada() {
        const matchId = this.ui.selectMatch?.value;
        if (!matchId) {
            this.matchCadastrada = null;
            this.ui.matchInfo.style.display = 'none';
            return;
        }

        await this.carregarPartidaCadastrada(matchId);
    }

    async carregarPartidaCadastrada(matchId) {
        const client = this.getClient();
        if (!client) return;

        const { data, error } = await client
            .from('fm_matches')
            .select('*')
            .eq('id', matchId)
            .single();

        if (error || !data) {
            this.matchCadastrada = null;
            return;
        }

        this.matchCadastrada = data;
        
        // Preenche info da partida
        if (this.ui.matchInfo) {
            const titleDisplay = data.title ? `<strong style="color:var(--accent-purple); display:block; margin-bottom:4px;">🏆 ${data.title}</strong>` : '';
            
            // Contagem de jogadores
            const players = Array.isArray(data.players) ? data.players : [];
            const totalJogadores = players.length;
            const teams = Array.isArray(data.teams) ? data.teams : [];
            
            let jogadoresPorTimeHtml = '';
            if (teams.length > 0 && totalJogadores > 0) {
                const detalhes = teams.map(t => {
                    const count = players.filter(p => p.teamId === t.id).length;
                    const bg = t.color || '#3b82f6';
                    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;background:${bg};color:#fff;font-size:0.72rem;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${t.name}: ${count}</span>`;
                }).join(' ');
                jogadoresPorTimeHtml = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${detalhes}</div>`;
            }

            this.ui.matchInfo.innerHTML = `
                ${titleDisplay}
                📅 ${data.date} às ${data.time}
                <br>📍 <small>${data.location || 'Local não informado'}</small>
                <br>👥 <small><strong>${totalJogadores}</strong> jogador${totalJogadores !== 1 ? 'es' : ''} confirmado${totalJogadores !== 1 ? 's' : ''}</small>
                ${jogadoresPorTimeHtml}
            `;
            this.ui.matchInfo.style.display = 'block';
        }

        // Menu suspenso de times
        if (this.ui.selectTime1 && this.ui.selectTime2) {
            const manualOption = '<option value="manual">Digitar manualmente...</option>';
            if (Array.isArray(data.teams) && data.teams.length > 0) {
                const options = data.teams.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
                this.ui.selectTime1.innerHTML = options + manualOption;
                this.ui.selectTime2.innerHTML = options + manualOption;

                this.ui.selectTime1.value = "0";
                this.ui.selectTime2.value = data.teams.length > 1 ? "1" : "0";

                this.ui.selectTime1.style.display = 'block';
                this.ui.selectTime2.style.display = 'block';
                this.ui.selectTime1.dispatchEvent(new Event('change'));
                this.ui.selectTime2.dispatchEvent(new Event('change'));
            } else {
                this.ui.selectTime1.innerHTML = manualOption;
                this.ui.selectTime2.innerHTML = manualOption;
                this.ui.selectTime1.style.display = 'none';
                this.ui.selectTime2.style.display = 'none';
                this.ui.selectTime1.dispatchEvent(new Event('change'));
                this.ui.selectTime2.dispatchEvent(new Event('change'));
            }
        }

        // Carrega jogadores para autocomplete e pega as cores
        if (Array.isArray(data.players)) {
            const players1 = data.players.filter(p => p.teamId === data.teams[0]?.id);
            const players2 = data.players.filter(p => p.teamId === data.teams[1]?.id);
            this.autocompleteCache.time1 = players1.map(p => p.username || p.name || '');
            this.autocompleteCache.time2 = players2.map(p => p.username || p.name || '');
        }

        if (Array.isArray(data.teams) && data.teams.length >= 2) {
            this.matchCadastrada.teamColors = {
                time1: data.teams[0]?.color || '#60a5fa',
                time2: data.teams[1]?.color || '#fb7185'
            };
        }
    }

    mostrarConfig() {
        this.ui.configSection.classList.remove('hidden');
        this.ui.liveSection.classList.add('hidden');
    }

    mostrarLive() {
        if (!this.partidaAtual) return;
        this.ui.configSection.classList.add('hidden');
        this.ui.liveSection.classList.remove('hidden');

        const p = this.partidaAtual;
        
        // Cores reais para fundo dos pills
        const bg1 = p.time1_color || '#60a5fa';
        const bg2 = p.time2_color || '#fb7185';
        this.ui.liveSection.style.setProperty('--color-t1', bg1);
        this.ui.liveSection.style.setProperty('--color-t2', bg2);

        // Placar — estilo pill sólido nos nomes
        this.ui.nomeTime1.textContent = p.time1_nome;
        this.ui.nomeTime2.textContent = p.time2_nome;
        this.ui.nomeTime1.style.cssText = `background:${bg1};color:#fff;padding:4px 12px;border-radius:20px;text-shadow:0 1px 2px rgba(0,0,0,0.3);font-weight:700;display:inline-block;`;
        this.ui.nomeTime2.style.cssText = `background:${bg2};color:#fff;padding:4px 12px;border-radius:20px;text-shadow:0 1px 2px rgba(0,0,0,0.3);font-weight:700;display:inline-block;`;
        this.ui.placarTime1.textContent = p.time1_gols || 0;
        this.ui.placarTime2.textContent = p.time2_gols || 0;

        // Período
        this.atualizarPeriodo(p.periodo || '1T');

        // Render
        this.atualizarStatus();
        this.gerenciarCronometro();
        this.renderEscalacao();
        this.renderGols();
        this.renderCartoes();
        this.renderSubstituicoes();
        this.renderEventos();
        
        // Observações
        if (this.ui.observacoes) {
            this.ui.observacoes.value = p.observacoes || '';
        }
    }

    // === INICIAR PARTIDA ===
    async iniciarPartida() {
        let time1Nome = this.ui.inputTime1Nome.value.trim();
        let time2Nome = this.ui.inputTime2Nome.value.trim();
        let t1Color = '#60a5fa';
        let t2Color = '#fb7185';
        let t1Id = null;
        let t2Id = null;

        if (this.ui.selectTime1?.style.display !== 'none' && this.ui.selectTime1?.value !== 'manual') {
            const idx = parseInt(this.ui.selectTime1.value);
            const team = this.matchCadastrada.teams[idx];
            if (team) {
                time1Nome = team.name;
                t1Color = team.color || t1Color;
                t1Id = team.id;
            }
        }

        if (this.ui.selectTime2?.style.display !== 'none' && this.ui.selectTime2?.value !== 'manual') {
            const idx = parseInt(this.ui.selectTime2.value);
            const team = this.matchCadastrada.teams[idx];
            if (team) {
                time2Nome = team.name;
                t2Color = team.color || t2Color;
                t2Id = team.id;
            }
        }

        if (!time1Nome || !time2Nome) {
            FMModal.warning('Preencha ou selecione os nomes dos dois times.');
            return;
        }

        const client = this.getClient();
        if (!client) return;

        // Verifica se já tem partida em andamento
        const { data: emAndamento } = await client
            .from('fm_partidas_ao_vivo')
            .select('id')
            .eq('status', 'em-andamento')
            .maybeSingle();

        if (emAndamento) {
            FMModal.warning('Já existe uma partida em andamento. Finalize-a antes de iniciar outra.');
            return;
        }

        // Preparar escalação inicial se partida vinculada
        let escalacaoInicial = { time1: [], time2: [] };
        if (this.matchCadastrada && Array.isArray(this.matchCadastrada.players)) {
            if (t1Id) {
                escalacaoInicial.time1 = this.matchCadastrada.players
                    .filter(p => p.teamId === t1Id)
                    .map(p => ({ nome: p.username || p.name || '', numero: p.number || '', posicao: p.posicao || '' }));
            }
            if (t2Id) {
                escalacaoInicial.time2 = this.matchCadastrada.players
                    .filter(p => p.teamId === t2Id)
                    .map(p => ({ nome: p.username || p.name || '', numero: p.number || '', posicao: p.posicao || '' }));
            }
        }

        const novaPartida = {
            match_id: this.matchCadastrada?.id || null,
            time1_nome: time1Nome,
            time2_nome: time2Nome,
            status: 'em-andamento',
            periodo: '1T',
            time1_gols: 0,
            time2_gols: 0,
            time1_cartoes_vermelhos: 0,
            time2_cartoes_vermelhos: 0,
            gols_registrados: { time1: [], time2: [] },
            cartoes_vermelhos_registrados: { time1: [], time2: [] },
            cartoes_amarelos_registrados: { time1: [], time2: [] },
            time1_color: t1Color,
            time2_color: t2Color,
            escalacao: escalacaoInicial,
            substituicoes: [],
            eventos_personalizados: [],
            observacoes: '',
            cronometro_state: { minutos: 7, segundos: 0, rodando: false },
        };

        const { data, error } = await client
            .from('fm_partidas_ao_vivo')
            .insert(novaPartida)
            .select('*')
            .single();

        if (error) {
            console.error('Erro ao iniciar partida:', error);
            FMModal.error('Não foi possível iniciar a partida. Verifique se você está logado como administrador.');
        } else {
            this.partidaAtual = data;
            this.mostrarLive();
            FMModal.success('Partida iniciada com sucesso!');
        }
    }

    // === PERÍODO ===
    async mudarPeriodo(novoPeriodo) {
        if (!this.partidaAtual) return;
        
        this.partidaAtual.periodo = novoPeriodo;
        this.atualizarPeriodo(novoPeriodo);

        const client = this.getClient();
        if (!client) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ periodo: novoPeriodo })
            .eq('id', this.partidaAtual.id);
    }

    atualizarPeriodo(periodo) {
        this.ui.periodoBtn1T?.classList.toggle('active', periodo === '1T');
        this.ui.periodoBtn2T?.classList.toggle('active', periodo === '2T');
        this.ui.periodoBtnPR?.classList.toggle('active', periodo === 'PR');
    }

    // === ESCALAÇÃO ===
    renderEscalacao() {
        if (!this.partidaAtual) return;
        const escalacao = this.partidaAtual.escalacao || { time1: [], time2: [] };

        const renderTime = (jogadores, timeEl, timeKey) => {
            if (!timeEl) return;
            timeEl.innerHTML = (jogadores || []).map((j, i) => `
                <div class="adm-escalacao-item" style="cursor:pointer; transition:0.2s; padding:8px; border-radius:8px; background:rgba(255,255,255,0.03); margin-bottom:4px; display:flex; align-items:center; gap:8px;" onclick="window.placarAdminInstance.registrarGolClicado('${timeKey}', '${j.nome.replace(/'/g, "\\'")}')" title="Clique para registrar gol de ${j.nome}">
                    <span class="adm-esc-numero" style="width:24px; height:24px; background:rgba(255,255,255,0.1); border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:bold;">${j.numero || '-'}</span>
                    <span class="adm-esc-nome" style="flex:1;">${j.nome}</span>
                    <span class="adm-esc-posicao" style="font-size:0.7rem; color:var(--text-muted);">${j.posicao || ''}</span>
                    <i class="fas fa-futbol" style="color:rgba(255,255,255,0.15);"></i>
                </div>
            `).join('') || '<div class="adm-esc-empty">Nenhum jogador</div>';
        };

        renderTime(escalacao.time1, this.ui.escalacaoT1, 'time1');
        renderTime(escalacao.time2, this.ui.escalacaoT2, 'time2');
    }

    abrirModalJogador() {
        if (!this.ui.modalJogador) return;
        this.ui.modalNome.value = '';
        this.ui.modalTime.value = 'time1';
        this.ui.modalJogador.classList.remove('hidden');
    }

    fecharModalJogador() {
        if (this.ui.modalJogador) {
            this.ui.modalJogador.classList.add('hidden');
        }
    }

    async confirmarJogadorManual() {
        const nome = this.ui.modalNome?.value?.trim();
        const time = this.ui.modalTime?.value;

        if (!nome) {
            FMModal.warning('Digite o nome do jogador.');
            return;
        }

        if (!this.partidaAtual) return;

        const escalacao = this.partidaAtual.escalacao || { time1: [], time2: [] };
        const timeKey = time === 'time1' ? 'time1' : 'time2';

        escalacao[timeKey].push({ nome, numero: '', posicao: '' });
        this.partidaAtual.escalacao = escalacao;

        const client = this.getClient();
        if (!client) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ escalacao })
            .eq('id', this.partidaAtual.id);

        this.renderEscalacao();
        this.fecharModalJogador();
    }

    // === AUTOCOMPLETE ===
    mostrarSugestoes(event, timeKey, tipo) {
        const input = event.target;
        const valor = input.value.toLowerCase();
        let suggestEl = null;

        if (tipo === 'gol') {
            suggestEl = timeKey === 'time1' ? this.ui.suggestGolT1 : this.ui.suggestGolT2;
        } else if (tipo === 'cartao') {
            suggestEl = timeKey === 'time1' ? this.ui.suggestCartaoT1 : this.ui.suggestCartaoT2;
        }

        if (!suggestEl) return;

        if (valor.length < 1) {
            suggestEl.innerHTML = '';
            return;
        }

        const sugestoes = this.autocompleteCache[timeKey]
            .filter(nome => nome.toLowerCase().includes(valor))
            .slice(0, 5);

        suggestEl.innerHTML = sugestoes.map(nome => 
            `<div class="adm-suggest-item" onclick="event.stopPropagation(); this.parentElement.previousElementSibling.value='${nome}'; this.parentElement.innerHTML='';">${nome}</div>`
        ).join('');
    }

    // === REGISTRAR GOL ===
    async registrarGol(timeKey) {
        if (!this.partidaAtual) return;

        const input = timeKey === 'time1' ? this.ui.inputGolT1 : this.ui.inputGolT2;
        const jogador = input.value.trim();

        if (!jogador) {
            FMModal.warning('Digite o nome do jogador que marcou o gol.');
            return;
        }

        const gols = this.partidaAtual.gols_registrados || { time1: [], time2: [] };
        const { minutos, segundos } = this.partidaAtual.cronometro_state || { minutos: 0, segundos: 0 };
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        gols[timeKey].push({ jogador, minuto: tempo });
        this.partidaAtual.gols_registrados = gols;

        // Incrementa placar
        await this.ajustarPlacar(timeKey, 1);

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update({ gols_registrados: gols })
            .eq('id', this.partidaAtual.id);

        if (!error) {
            this.renderGols();
            input.value = '';
            if (typeof this.mostrarSugestoes === 'function') {
                const el = timeKey === 'time1' ? this.ui.suggestGolT1 : this.ui.suggestGolT2;
                if (el) el.innerHTML = '';
            }
        }
    }

    // === REGISTRAR GOL CLICADO ===
    async registrarGolClicado(timeKey, jogadorNome) {
        if (!this.partidaAtual) return;
        const confirm = await FMModal.confirm({
            type: 'admin',
            title: 'Registrar Gol',
            message: `Registrar gol para <b>${jogadorNome}</b>?`,
            confirmLabel: 'Confirmar Gol',
            cancelLabel: 'Cancelar',
        });
        if (!confirm) return;

        const input = timeKey === 'time1' ? this.ui.inputGolT1 : this.ui.inputGolT2;
        if (input) input.value = jogadorNome;
        await this.registrarGol(timeKey);
    }

    // === REGISTRAR CARTÃO ===
    async registrarCartao(timeKey, tipoCarta) {
        if (!this.partidaAtual) return;

        const input = timeKey === 'time1' ? this.ui.inputCartaoT1 : this.ui.inputCartaoT2;
        const jogador = input.value.trim();

        if (!jogador) {
            FMModal.warning('Digite o nome do jogador que recebeu cartão.');
            return;
        }

        const { minutos, segundos } = this.partidaAtual.cronometro_state || { minutos: 0, segundos: 0 };
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        let updateData = {};

        if (tipoCarta === 'amarelo') {
            const cartoesAmarelos = this.partidaAtual.cartoes_amarelos_registrados || { time1: [], time2: [] };
            cartoesAmarelos[timeKey].push({ jogador, minuto: tempo, tipo: 'amarelo' });
            this.partidaAtual.cartoes_amarelos_registrados = cartoesAmarelos;
            updateData.cartoes_amarelos_registrados = cartoesAmarelos;
        } else {
            const cartoesVermelhos = this.partidaAtual.cartoes_vermelhos_registrados || { time1: [], time2: [] };
            cartoesVermelhos[timeKey].push({ jogador, minuto: tempo, tipo: 'vermelho' });
            this.partidaAtual.cartoes_vermelhos_registrados = cartoesVermelhos;
            updateData.cartoes_vermelhos_registrados = cartoesVermelhos;

            const campoCartoes = timeKey === 'time1' ? 'time1_cartoes_vermelhos' : 'time2_cartoes_vermelhos';
            this.partidaAtual[campoCartoes] = (this.partidaAtual[campoCartoes] || 0) + 1;
            updateData[campoCartoes] = this.partidaAtual[campoCartoes];
        }

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update(updateData)
            .eq('id', this.partidaAtual.id);

        if (!error) {
            this.renderCartoes();
            input.value = '';
        }
    }

    // === SUBSTITUIÇÃO ===
    async registrarSubstituicao(timeKey) {
        if (!this.partidaAtual) return;

        const inputSai = timeKey === 'time1' ? this.ui.inputSubSaiT1 : this.ui.inputSubSaiT2;
        const inputEntra = timeKey === 'time1' ? this.ui.inputSubEntraT1 : this.ui.inputSubEntraT2;
        
        const sai = inputSai?.value?.trim();
        const entra = inputEntra?.value?.trim();

        if (!sai || !entra) {
            FMModal.warning('Preencha o jogador que sai e o que entra.');
            return;
        }

        const { minutos, segundos } = this.partidaAtual.cronometro_state || { minutos: 0, segundos: 0 };
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        const substituicoes = this.partidaAtual.substituicoes || [];
        substituicoes.push({ minuto: tempo, time: timeKey, sai, entra });
        this.partidaAtual.substituicoes = substituicoes;

        const client = this.getClient();
        if (!client) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ substituicoes })
            .eq('id', this.partidaAtual.id);

        this.renderSubstituicoes();
        if (inputSai) inputSai.value = '';
        if (inputEntra) inputEntra.value = '';
    }

    renderSubstituicoes() {
        if (!this.ui.listaSubstituicoes) return;
        const subs = this.partidaAtual?.substituicoes || [];

        this.ui.listaSubstituicoes.innerHTML = subs.map(s => `
            <div class="adm-sub-item">
                <span class="adm-sub-time">${s.time === 'time1' ? this.ui.nomeTime1.textContent : this.ui.nomeTime2.textContent}</span>
                <span class="adm-sub-minuto">${s.minuto}'</span>
                <span class="adm-sub-players">${s.sai} <i class="fas fa-arrow-right"></i> ${s.entra}</span>
            </div>
        `).join('') || '<div class="adm-empty-msg">Nenhuma substituição ainda</div>';
    }

    // === EVENTOS PERSONALIZADOS ===
    async adicionarEvento() {
        if (!this.ui.inputEvento || !this.partidaAtual) return;

        const descricao = this.ui.inputEvento.value.trim();
        if (!descricao) {
            FMModal.warning('Digite uma descrição para o evento.');
            return;
        }

        const { minutos, segundos } = this.partidaAtual.cronometro_state || { minutos: 0, segundos: 0 };
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        const eventos = this.partidaAtual.eventos_personalizados || [];
        eventos.push({ minuto: tempo, descricao });
        this.partidaAtual.eventos_personalizados = eventos;

        const client = this.getClient();
        if (!client) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ eventos_personalizados: eventos })
            .eq('id', this.partidaAtual.id);

        this.renderEventos();
        this.ui.inputEvento.value = '';
    }

    renderEventos() {
        if (!this.ui.listaEventos) return;
        const eventos = this.partidaAtual?.eventos_personalizados || [];

        this.ui.listaEventos.innerHTML = eventos.map(e => `
            <li class="adm-evento-item">
                <span class="adm-evento-minuto">${e.minuto}'</span>
                <span class="adm-evento-desc">${e.descricao}</span>
            </li>
        `).join('') || '<li style="color:var(--text-muted)">Nenhum evento personalizado</li>';
    }

    // === OBSERVAÇÕES ===
    async salvarObservacoes() {
        if (!this.ui.observacoes || !this.partidaAtual) return;

        const obs = this.ui.observacoes.value;
        this.partidaAtual.observacoes = obs;

        const client = this.getClient();
        if (!client) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ observacoes: obs })
            .eq('id', this.partidaAtual.id);

        FMModal.success('Observações salvas!');
    }

    // === CRONÔMETRO ===
    gerenciarCronometro() {
        clearInterval(this.cronometroInterval);
        if (!this.partidaAtual?.cronometro_state) return;

        let { minutos, segundos, rodando } = this.partidaAtual.cronometro_state;
        this.exibirCronometro(minutos, segundos);

        if (rodando) {
            this.ui.btnPlayPause.innerHTML = '<i class="fas fa-pause"></i>';
            this.cronometroInterval = setInterval(async () => {
                if (segundos > 0) {
                    segundos--;
                } else if (minutos > 0) {
                    minutos--;
                    segundos = 59;
                } else {
                    clearInterval(this.cronometroInterval);
                    this.partidaAtual.cronometro_state.rodando = false;
                    await this.salvarCronometro(0, 0, false);
                    this.ui.btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
                    this.atualizarStatus();
                    
                    // Finaliza a partida quando o cronômetro chega a zero
                    FMModal.warning('Fim de jogo! Tempo esgotado (7 minutos). A partida será finalizada agora.');
                    await this.finalizarPartida(true); // pass true to skip confirmation
                    return;
                }
                this.partidaAtual.cronometro_state.minutos = minutos;
                this.partidaAtual.cronometro_state.segundos = segundos;
                this.exibirCronometro(minutos, segundos);

                // Salva a cada 5 segundos
                if (segundos % 5 === 0) {
                    await this.salvarCronometro(minutos, segundos, true);
                }
            }, 1000);
        } else {
            this.ui.btnPlayPause.innerHTML = '<i class="fas fa-play"></i>';
        }
    }

    async toggleCronometro() {
        if (!this.partidaAtual) return;
        const novoEstado = !this.partidaAtual.cronometro_state.rodando;
        this.partidaAtual.cronometro_state.rodando = novoEstado;
        await this.salvarCronometro(
            this.partidaAtual.cronometro_state.minutos,
            this.partidaAtual.cronometro_state.segundos,
            novoEstado
        );
        this.atualizarStatus();
        this.gerenciarCronometro();
    }

    async resetCronometro() {
        if (!this.partidaAtual) return;
        clearInterval(this.cronometroInterval);
        this.partidaAtual.cronometro_state = { minutos: 7, segundos: 0, rodando: false };
        await this.salvarCronometro(7, 0, false);
        this.atualizarStatus();
        this.gerenciarCronometro();
    }

    exibirCronometro(min, seg) {
        this.ui.cronometro.textContent = `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
    }

    async salvarCronometro(minutos, segundos, rodando) {
        const client = this.getClient();
        if (!client || !this.partidaAtual) return;

        await client
            .from('fm_partidas_ao_vivo')
            .update({ cronometro_state: { minutos, segundos, rodando } })
            .eq('id', this.partidaAtual.id);
    }

    // === PLACAR ===
    async ajustarPlacar(timeKey, delta) {
        if (!this.partidaAtual) return;

        const campo = timeKey === 'time1' ? 'time1_gols' : 'time2_gols';
        const atual = this.partidaAtual[campo] || 0;
        const novo = Math.max(0, atual + delta);
        if (novo === atual) return;

        this.partidaAtual[campo] = novo;

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update({ [campo]: novo })
            .eq('id', this.partidaAtual.id);

        if (!error) {
            const el = timeKey === 'time1' ? this.ui.placarTime1 : this.ui.placarTime2;
            el.textContent = novo;

            // Finaliza a partida se um dos times atingir 2 gols
            if (novo >= 2) {
                const teamName = timeKey === 'time1' ? this.partidaAtual.time1_nome : this.partidaAtual.time2_nome;
                FMModal.success(`Fim de jogo! O time ${teamName} atingiu 2 gols. A partida será finalizada agora.`);
                await this.finalizarPartida(true); // skip confirmation
            }
        }
    }

    // === REGISTRAR GOL ===
    async registrarGol(timeKey) {
        if (!this.partidaAtual) return;

        const input = timeKey === 'time1' ? this.ui.inputGolT1 : this.ui.inputGolT2;
        const jogador = input.value.trim();

        if (!jogador) {
            FMModal.warning('Digite o nome do jogador que marcou o gol.');
            return;
        }

        const gols = this.partidaAtual.gols_registrados || { time1: [], time2: [] };
        const { minutos, segundos } = this.partidaAtual.cronometro_state;
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        gols[timeKey].push({ jogador, minuto: tempo });
        this.partidaAtual.gols_registrados = gols;

        // Incrementa placar
        await this.ajustarPlacar(timeKey, 1);

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update({ gols_registrados: gols })
            .eq('id', this.partidaAtual.id);

        if (!error) {
            this.renderGols();
            input.value = '';
        }
    }

    // === REGISTRAR CARTÃO ===
    async registrarCartao(timeKey) {
        if (!this.partidaAtual) return;

        const input = timeKey === 'time1' ? this.ui.inputCartaoT1 : this.ui.inputCartaoT2;
        const jogador = input.value.trim();

        if (!jogador) {
            FMModal.warning('Digite o nome do jogador que recebeu o cartao.');
            return;
        }

        const cartoes = this.partidaAtual.cartoes_vermelhos_registrados || { time1: [], time2: [] };
        const { minutos, segundos } = this.partidaAtual.cronometro_state;
        const tempo = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

        cartoes[timeKey].push({ jogador, minuto: tempo });
        this.partidaAtual.cartoes_vermelhos_registrados = cartoes;

        const campoCartoes = timeKey === 'time1' ? 'time1_cartoes_vermelhos' : 'time2_cartoes_vermelhos';
        const novoTotal = (this.partidaAtual[campoCartoes] || 0) + 1;
        this.partidaAtual[campoCartoes] = novoTotal;

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update({
                cartoes_vermelhos_registrados: cartoes,
                [campoCartoes]: novoTotal
            })
            .eq('id', this.partidaAtual.id);

        if (!error) {
            this.renderCartoes();
            input.value = '';
        }
    }

    // === RENDER ===
    renderGols() {
        if (!this.partidaAtual) return;
        const gols = this.partidaAtual.gols_registrados || { time1: [], time2: [] };

        this.ui.listaGolsT1.innerHTML = (gols.time1 || []).map(g =>
            `<li>⚽ (${g.minuto}) ${g.jogador}</li>`
        ).join('') || '<li style="color:var(--text-muted)">Nenhum gol</li>';

        this.ui.listaGolsT2.innerHTML = (gols.time2 || []).map(g =>
            `<li>⚽ (${g.minuto}) ${g.jogador}</li>`
        ).join('') || '<li style="color:var(--text-muted)">Nenhum gol</li>';
    }

    renderCartoes() {
        if (!this.ui.listaCartoesT1) return;
        
        const cartoesVermelhos = this.partidaAtual?.cartoes_vermelhos_registrados || { time1: [], time2: [] };
        const cartoesAmarelos = this.partidaAtual?.cartoes_amarelos_registrados || { time1: [], time2: [] };

        const renderCartoes = (vermelhos, amarelos, listaEl) => {
            const todos = [
                ...vermelhos.map(c => ({ ...c, tipo: 'vermelho' })),
                ...amarelos.map(c => ({ ...c, tipo: 'amarelo' }))
            ];
            listaEl.innerHTML = todos.map(c => `
                <li class="adm-cartao-item ${c.tipo}">
                    ${c.tipo === 'vermelho' ? '🟥' : '🟨'} (${c.minuto}) ${c.jogador}
                </li>
            `).join('') || '<li style="color:var(--text-muted)">Nenhum cartão</li>';
        };

        renderCartoes(cartoesVermelhos.time1 || [], cartoesAmarelos.time1 || [], this.ui.listaCartoesT1);
        renderCartoes(cartoesVermelhos.time2 || [], cartoesAmarelos.time2 || [], this.ui.listaCartoesT2);
    }

    atualizarStatus() {
        if (!this.partidaAtual) return;
        const rodando = this.partidaAtual.cronometro_state?.rodando;
        if (rodando) {
            this.ui.statusBadge.className = 'adm-status live';
            this.ui.statusBadge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pav-pulse 1.5s infinite"></span> AO VIVO';
        } else {
            this.ui.statusBadge.className = 'adm-status paused';
            this.ui.statusBadge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:var(--text-muted)"></span> PAUSADO';
        }
    }

    // === FINALIZAR ===
    async finalizarPartida(skipConfirmation = false) {
        if (!this.partidaAtual) return;
        
        if (!skipConfirmation) {
            const confirmed = await FMModal.confirm({
                type: 'admin',
                title: 'Finalizar partida',
                message: 'Tem certeza que deseja finalizar a partida?',
                confirmLabel: 'Finalizar',
                danger: true,
                priority: 80
            });
            if (!confirmed) return;
        }

        clearInterval(this.cronometroInterval);

        const client = this.getClient();
        if (!client) return;

        const { error } = await client
            .from('fm_partidas_ao_vivo')
            .update({
                status: 'finalizada',
                cronometro_state: { minutos: 0, segundos: 0, rodando: false }
            })
            .eq('id', this.partidaAtual.id);

        if (error) {
            console.error('Erro ao finalizar:', error);
            FMModal.error('Erro ao finalizar a partida.');
        } else {
            FMModal.success('Partida finalizada com sucesso!');
            this.partidaAtual = null;
            this.mostrarConfig();
            this.carregarHistorico();
            // Recarrega a lista de competições e standings
            setTimeout(() => {
                this.carregarCompeticoesStandings();
            }, 500);
        }
    }

    // === HISTÓRICO COM DROPDOWN ===
    async carregarHistorico() {
        const client = this.getClient();
        if (!client || !this.ui.historicoSelect) return;

        // Busca todas as partidas finalizadas para montar o dropdown
        const { data, error } = await client
            .from('fm_partidas_ao_vivo')
            .select('id, match_id, time1_nome, time2_nome, updated_at')
            .eq('status', 'finalizada')
            .order('updated_at', { ascending: false })
            .limit(50);

        if (error || !data || data.length === 0) {
            this.ui.historicoSelect.innerHTML = '<option value="">— Nenhuma partida finalizada —</option>';
            this.ui.historicoLista.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Nenhuma partida finalizada ainda.</p>';
            return;
        }

        // Agrupa por match_id (competição)
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

        // Busca títulos das competições
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

        // Preenche o dropdown
        this.ui.historicoSelect.innerHTML = '<option value="">— Escolha uma competição —</option>';
        for (const [compId, comp] of competicaoMap) {
            const title = comp.title || `${comp.partidas[0].time1_nome} vs ${comp.partidas[0].time2_nome}`;
            const option = document.createElement('option');
            option.value = compId;
            option.textContent = `${title} (${comp.partidas.length} partida${comp.partidas.length > 1 ? 's' : ''})`;
            this.ui.historicoSelect.appendChild(option);
        }

        // Listener para carregar detalhes quando selecionar
        this.ui.historicoSelect.addEventListener('change', () => {
            const selectedId = this.ui.historicoSelect.value;
            if (selectedId) {
                this.carregarHistoricoDetalhado(selectedId);
            } else {
                this.ui.historicoLista.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Selecione uma competição para ver o histórico detalhado.</p>';
            }
        });
    }

    async carregarHistoricoDetalhado(competicaoId) {
        const client = this.getClient();
        if (!client || !this.ui.historicoLista) return;

        // Busca todas as partidas finalizadas daquela competição
        let query = client
            .from('fm_partidas_ao_vivo')
            .select('*')
            .eq('status', 'finalizada')
            .order('updated_at', { ascending: false })
            .limit(20);

        // Se o competicaoId parece um match_id (não é UUID), filtra por match_id
        // Se for UUID, filtra por id
        if (competicaoId.length === 36 && competicaoId.includes('-')) {
            query = query.eq('id', competicaoId);
        } else {
            query = query.eq('match_id', competicaoId);
        }

        const { data, error } = await query;

        if (error || !data || data.length === 0) {
            this.ui.historicoLista.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Nenhuma partida encontrada para esta competição.</p>';
            return;
        }

        // Busca título da competição
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

        // Título da competição
        if (competicaoTitulo) {
            html += `
                <div style="text-align:center;margin-bottom:20px;padding:12px;background:rgba(245,158,11,0.08);border-radius:12px;border:1px solid rgba(245,158,11,0.15);">
                    <i class="fas fa-trophy" style="color:#f59e0b;margin-right:6px;"></i>
                    <strong style="font-size:1rem;color:var(--text-main);">${this.escapeHtml(competicaoTitulo)}</strong>
                </div>`;
        }

        partidas.forEach((p, idx) => {
            const dataObj = new Date(p.updated_at);
            const dataFormatada = dataObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const horaFormatada = dataObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const bg1 = p.time1_color || '#60a5fa';
            const bg2 = p.time2_color || '#fb7185';
            const win1 = p.time1_gols > p.time2_gols;
            const win2 = p.time2_gols > p.time1_gols;
            const empate = p.time1_gols === p.time2_gols;

            // Gols por jogador
            const gols = p.gols_registrados || { time1: [], time2: [] };
            const golsT1 = gols.time1 || [];
            const golsT2 = gols.time2 || [];

            // Agrupa gols por jogador
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
                if (lista.length === 0) return '<span style="color:var(--text-muted);font-size:0.78rem;">—</span>';
                return lista.map(a => `
                    <div style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px;padding:3px 8px;background:${bgColor};color:#fff;border-radius:12px;font-size:0.72rem;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.3);">
                        ⚽ ${a.gols}x ${this.escapeHtml(a.jogador)}
                        <span style="opacity:0.7;font-weight:400;">(${a.minutos.join(', ')})</span>
                    </div>
                `).join('');
            };

            // Cartões
            const cartoesVerm = p.cartoes_vermelhos_registrados || { time1: [], time2: [] };
            const cartoesAm = p.cartoes_amarelos_registrados || { time1: [], time2: [] };

            const renderCartoes = (timeKey) => {
                const verm = (cartoesVerm[timeKey] || []).map(c => `<span style="display:inline-flex;align-items:center;gap:2px;margin:1px 3px;font-size:0.7rem;">🟥 ${this.escapeHtml(c.jogador)} (${c.minuto})</span>`).join('');
                const am = (cartoesAm[timeKey] || []).map(c => `<span style="display:inline-flex;align-items:center;gap:2px;margin:1px 3px;font-size:0.7rem;">🟨 ${this.escapeHtml(c.jogador)} (${c.minuto})</span>`).join('');
                return verm + am || '<span style="color:var(--text-muted);font-size:0.7rem;">Nenhum</span>';
            };

            // Resultado
            let resultadoBadge = '';
            if (empate) {
                resultadoBadge = '<span style="background:rgba(251,191,36,0.15);color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;">EMPATE</span>';
            }

            html += `
                <div class="adm-hist-item" style="margin-bottom:16px;">
                    <div class="adm-hist-date-badge">
                        <i class="far fa-calendar-alt"></i> ${dataFormatada} <span class="time-muted">${horaFormatada}</span>
                        ${resultadoBadge}
                    </div>
                    <div class="adm-hist-match">
                        <div class="adm-hist-team left ${win1 ? 'winner' : ''}" style="background:${bg1};color:#fff;border-radius:20px;padding:4px 10px;text-shadow:0 1px 2px rgba(0,0,0,0.3);${win1 ? 'font-weight:800;' : ''}">
                            <span class="team-name">${this.escapeHtml(p.time1_nome)}</span>
                        </div>
                        <div class="adm-hist-score-box">
                            <span class="score-badge s1 ${win1 ? 'winner' : ''}" style="color:${win1 ? bg1 : 'var(--text-secondary)'}">${p.time1_gols}</span>
                            <span class="sep">×</span>
                            <span class="score-badge s2 ${win2 ? 'winner' : ''}" style="color:${win2 ? bg2 : 'var(--text-secondary)'}">${p.time2_gols}</span>
                        </div>
                        <div class="adm-hist-team right ${win2 ? 'winner' : ''}" style="background:${bg2};color:#fff;border-radius:20px;padding:4px 10px;text-shadow:0 1px 2px rgba(0,0,0,0.3);${win2 ? 'font-weight:800;' : ''}">
                            <span class="team-name">${this.escapeHtml(p.time2_nome)}</span>
                        </div>
                    </div>

                    <!-- Detalhes: Gols -->
                    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">
                                    ⚽ Gols - ${this.escapeHtml(p.time1_nome)}
                                </div>
                                ${renderArtilheiros(artilheirosT1, bg1)}
                            </div>
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">
                                    ⚽ Gols - ${this.escapeHtml(p.time2_nome)}
                                </div>
                                ${renderArtilheiros(artilheirosT2, bg2)}
                            </div>
                        </div>
                    </div>

                    <!-- Detalhes: Cartões -->
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">
                                    🟨🟥 Cartões - ${this.escapeHtml(p.time1_nome)}
                                </div>
                                ${renderCartoes('time1')}
                            </div>
                            <div>
                                <div style="font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">
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

        // Busca todas as competições que têm classificação
        const { data, error } = await client
            .from('fm_standings')
            .select('match_id')
            .order('updated_at', { ascending: false });

        if (error || !data) {
            this.ui.standingsSelect.innerHTML = '<option value="">— Nenhuma competição disponível —</option>';
            return;
        }

        // Pega match_ids únicos
        const matchIds = [...new Set(data.map(d => d.match_id))];

        // Busca os títulos das competições
        const matchTitles = {};
        if (matchIds.length > 0) {
            // Busca em fm_matches
            const { data: matches } = await client
                .from('fm_matches')
                .select('id, title, date')
                .in('id', matchIds);

            if (matches) {
                matches.forEach(m => {
                    matchTitles[m.id] = m.title || `Partida ${m.date || m.id}`;
                });
            }

            // Para match_ids que não estão em fm_matches (partidas manuais),
            // busca em fm_partidas_ao_vivo
            const missingIds = matchIds.filter(id => !matchTitles[id]);
            if (missingIds.length > 0) {
                const { data: liveMatches } = await client
                    .from('fm_partidas_ao_vivo')
                    .select('id, time1_nome, time2_nome, updated_at')
                    .in('id', missingIds);

                if (liveMatches) {
                    liveMatches.forEach(m => {
                        matchTitles[m.id] = `${m.time1_nome} vs ${m.time2_nome}`;
                    });
                }
            }
        }

        // Preenche o select
        this.ui.standingsSelect.innerHTML = '<option value="">— Escolha uma competição —</option>';
        matchIds.forEach(id => {
            const title = matchTitles[id] || id;
            const option = document.createElement('option');
            option.value = id;
            option.textContent = title;
            this.ui.standingsSelect.appendChild(option);
        });

        // Listener para carregar a classificação quando selecionar
        this.ui.standingsSelect.addEventListener('change', () => {
            const selectedId = this.ui.standingsSelect.value;
            if (selectedId) {
                this.carregarStandings(selectedId);
            } else {
                this.ui.standingsContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Selecione uma competição para ver a classificação.</p>';
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

        if (error) {
            console.error('Erro ao carregar classificação:', error);
            this.ui.standingsContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Erro ao carregar classificação.</p>';
            return;
        }

        if (!data || data.length === 0) {
            this.ui.standingsContainer.innerHTML = `
                <div class="adm-standings-empty">
                    <i class="fas fa-trophy"></i>
                    Nenhuma classificação disponível para esta competição.
                </div>`;
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
                    <td><span class="standings-pos">${pos}º</span></td>
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
            <div class="adm-standings-table-wrap">
                <table class="adm-standings-table">
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

    // === REALTIME ===
    setupRealtimeListeners() {
        const client = this.getClient();
        if (!client) return;

        // Canal para admin (atualiza tudo em tempo real)
        client.channel('fm-placar-admin')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'fm_partidas_ao_vivo' },
                (payload) => {
                    if (this.partidaAtual && payload.new.id === this.partidaAtual.id) {
                        console.log('[Admin] Atualização recebida:', payload.eventType);
                        
                        // Verifica o que mudou para atualizar apenas o necessário
                        const cronometroMudou = JSON.stringify(payload.new.cronometro_state) !== JSON.stringify(this.partidaAtual.cronometro_state);
                        const placarMudou = this.partidaAtual.time1_gols !== payload.new.time1_gols || this.partidaAtual.time2_gols !== payload.new.time2_gols;
                        const golsMudaram = JSON.stringify(this.partidaAtual.gols_registrados) !== JSON.stringify(payload.new.gols_registrados);
                        const cartoesMudaram = JSON.stringify(this.partidaAtual.cartoes_vermelhos_registrados) !== JSON.stringify(payload.new.cartoes_vermelhos_registrados) ||
                                             JSON.stringify(this.partidaAtual.cartoes_amarelos_registrados) !== JSON.stringify(payload.new.cartoes_amarelos_registrados);
                        const subsMudaram = JSON.stringify(this.partidaAtual.substituicoes) !== JSON.stringify(payload.new.substituicoes);
                        const eventosMudaram = JSON.stringify(this.partidaAtual.eventos_personalizados) !== JSON.stringify(payload.new.eventos_personalizados);
                        const escalacaoMudou = JSON.stringify(this.partidaAtual.escalacao) !== JSON.stringify(payload.new.escalacao);
                        const periodoMudou = this.partidaAtual.periodo !== payload.new.periodo;
                        
                        // Atualiza dados locais
                        this.partidaAtual = { ...this.partidaAtual, ...payload.new };
                        
                        // Renderiza apenas o que mudou
                        if (placarMudou) {
                            this.ui.placarTime1.textContent = this.partidaAtual.time1_gols || 0;
                            this.ui.placarTime2.textContent = this.partidaAtual.time2_gols || 0;
                        }
                        if (golsMudaram) this.renderGols();
                        if (cartoesMudaram) this.renderCartoes();
                        if (subsMudaram) this.renderSubstituicoes();
                        if (eventosMudaram) this.renderEventos();
                        if (escalacaoMudou) this.renderEscalacao();
                        if (periodoMudou) this.atualizarPeriodo(this.partidaAtual.periodo);
                        if (cronometroMudou) this.gerenciarCronometro();
                        this.atualizarStatus();
                    }

                    // Quando a partida é finalizada
                    if (payload.new.status === 'finalizada' && this.partidaAtual && payload.new.id === this.partidaAtual.id) {
                        this.partidaAtual = null;
                        this.mostrarConfig();
                        this.carregarHistorico();
                        this.carregarCompeticoesStandings();
                        FMModal.success('Partida finalizada!');
                    }
                }
            )
            .subscribe();

        // Canal para standings (atualiza em tempo real)
        client.channel('fm-standings-admin')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'fm_standings' },
                () => {
                    // Recarrega a lista de competições e a classificação atual
                    this.carregarCompeticoesStandings();
                }
            )
            .subscribe();
    }
}

// Verifica autenticação e inicializa
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof getSupabaseClient === 'function') {
        getSupabaseClient();
    }

    // Verifica se o usuário é admin
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
    if (!currentUser || currentUser.role !== 'admin') {
        await FMModal.admin({
            title: 'Acesso restrito',
            message: 'Apenas administradores podem acessar esta pagina.',
            priority: 90
        });
        window.location.href = '../index.html';
        return;
    }

    // Inicializa a classe e expõe globalmente para os onclicks
    window.placarAdminInstance = new PlacarAdmin();
});
