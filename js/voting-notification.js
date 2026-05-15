/**
 * voting-notification.js
 * Sistema Inteligente de Notificação de Votação
 * 
 * Verifica votações abertas ao fazer login e exibe modal automático
 * com link direto para a página de votação.
 * 
 * Funcionalidades:
 * - Verifica votações abertas via RPC segura
 * - Modal automático após login
 * - Persistência de estado (não exibe novamente se já votou nas duas categorias)
 * - Sincronização realtime
 * - Controle de exibição única por sessão
 */
(function () {
    'use strict';

    const NOTIFICATION_SESSION_KEY = 'fm_voting_notification_shown';
    const NOTIFICATION_CHECK_INTERVAL = 60000; // 1 minuto
    let notificationInterval = null;
    let realtimeChannel = null;

    /**
     * Verifica se existem votações abertas para o jogador logado.
     * Usa a RPC get_open_voting_matches() que valida tudo no backend.
     */
    async function checkOpenVotings() {
        try {
            const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
            if (!client) return [];

            const { data, error } = await client.rpc('get_open_voting_matches');
            if (error) {
                console.warn('Erro ao verificar votações abertas:', error);
                return [];
            }

            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('Falha na verificação de votações:', e);
            return [];
        }
    }

    /**
     * Formata a data no padrão brasileiro
     */
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    }

    /**
     * Calcula tempo restante para o deadline
     */
    function getTimeRemaining(deadline) {
        if (!deadline) return 'Sem prazo definido';
        const now = new Date();
        const end = new Date(deadline);
        const diff = end - now;
        if (diff <= 0) return 'Prazo expirado';

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours}h ${minutes}m restantes`;
    }

    /**
     * Exibe o modal de notificação de votação
     */
    async function showVotingNotification(votingMatches) {
        if (!votingMatches || votingMatches.length === 0) return;
        if (typeof FMModal === 'undefined' || !FMModal.show) return;

        // Filtrar apenas partidas onde o jogador ainda não votou em todas as categorias
        const pendingMatches = votingMatches.filter(m => !m.voted_best || !m.voted_worst);
        if (pendingMatches.length === 0) return;

        // Verificar se já mostrou nesta sessão
        const sessionShown = sessionStorage.getItem(NOTIFICATION_SESSION_KEY);
        if (sessionShown) {
            const shownData = JSON.parse(sessionShown);
            // Verificar se são as mesmas partidas
            const currentIds = pendingMatches.map(m => m.id).sort().join(',');
            if (shownData.matchIds === currentIds && Date.now() - shownData.timestamp < 300000) {
                // Já mostrou para estas mesmas partidas nos últimos 5 minutos
                return;
            }
        }

        // Montar conteúdo do modal
        const matchesHtml = pendingMatches.map(match => {
            const statusParts = [];
            if (!match.voted_best) statusParts.push('⭐ Craque da Partida');
            if (!match.voted_worst) statusParts.push('🪵 Perna de Pau');

            return `
                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(245,158,11,0.2); border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">⚽</span>
                        <div>
                            <strong style="color: var(--text-main, #f8fafc); font-size: 1.05rem;">${match.location || 'Partida'}</strong>
                            <span style="display: block; font-size: 0.82rem; color: var(--text-secondary, #94a3b8);">
                                ${formatDate(match.date)} às ${match.time || ''}h • ${getTimeRemaining(match.voting_deadline)}
                            </span>
                        </div>
                    </div>
                    <div style="font-size: 0.88rem; color: var(--text-secondary, #94a3b8);">
                        <strong style="color: #fbbf24;">Votos pendentes:</strong> ${statusParts.join(' • ')}
                    </div>
                </div>
            `;
        }).join('');

        const message = pendingMatches.length === 1
            ? 'Existe uma votação pós-jogo aberta esperando seu voto!'
            : `Existem ${pendingMatches.length} votações abertas esperando seu voto!`;

        const result = await FMModal.show({
            type: 'vote',
            title: '🗳️ Votação Aberta!',
            message: message,
            priority: 75,
            id: 'voting_notification_modal',
            closeOnBackdrop: true,
            actions: [
                { id: 'later', label: 'Lembrar depois', value: false, variant: 'ghost' },
                { id: 'go_vote', label: '🗳️ Ir para votação', value: true, variant: 'primary' }
            ],
            // Injeta HTML personalizado via details
            details: null
        });

        // Marcar que mostrou nesta sessão
        sessionStorage.setItem(NOTIFICATION_SESSION_KEY, JSON.stringify({
            matchIds: pendingMatches.map(m => m.id).sort().join(','),
            timestamp: Date.now()
        }));

        if (result && result.value === true) {
            // Navegar para a partida mais recente com votação aberta
            const targetMatch = pendingMatches[0];
            sessionStorage.setItem('selectedMatchId', targetMatch.id);
            
            // Verificar se já estamos na página de detalhes
            const isDetailsPage = window.location.pathname.includes('details.html');
            if (isDetailsPage) {
                window.location.reload();
            } else {
                const isNestedPage = window.location.pathname.includes('/pages/');
                window.location.href = isNestedPage ? 'details.html' : 'pages/details.html';
            }
        }
    }

    /**
     * Configura subscription realtime para detectar encerramento de votações
     */
    function setupRealtimeSubscription() {
        const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
        if (!client || typeof client.channel !== 'function') return;

        if (realtimeChannel) {
            realtimeChannel.unsubscribe().catch(() => {});
        }

        realtimeChannel = client.channel('voting_notifications');
        realtimeChannel
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'fm_matches',
            }, async (payload) => {
                if (!payload?.new) return;
                const match = payload.new;

                // Se uma partida foi encerrada, verifica se há votação aberta
                if (match.status === 'ENCERRADA' && !match.results_processed) {
                    // Limpar cache da sessão para forçar recheck
                    sessionStorage.removeItem(NOTIFICATION_SESSION_KEY);
                    
                    // Aguarda 2 segundos para o banco processar
                    setTimeout(async () => {
                        const openVotings = await checkOpenVotings();
                        if (openVotings.length > 0) {
                            await showVotingNotification(openVotings);
                        }
                    }, 2000);
                }

                // Se resultados foram processados, fechar modal de notificação
                if (match.results_processed === true) {
                    if (typeof FMModal !== 'undefined' && FMModal.closeById) {
                        FMModal.closeById('voting_notification_modal');
                    }
                }
            })
            .subscribe();
    }

    /**
     * Inicializa o sistema de notificação de votação
     */
    async function initVotingNotification() {
        // Não executar em páginas de login/registro
        const pathname = window.location.pathname;
        if (pathname.endsWith('index.html') || pathname.endsWith('register.html') || pathname === '/' || pathname.endsWith('/')) {
            return;
        }

        // Verificar se o usuário está logado
        const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (!currentUser) {
            // Tenta novamente após 2 segundos (auth pode estar carregando)
            setTimeout(initVotingNotification, 2000);
            return;
        }

        // Visitantes não recebem notificação de votação
        if (currentUser.role === 'visitor') return;

        // Verificar votações abertas
        const openVotings = await checkOpenVotings();
        if (openVotings.length > 0) {
            // Delay de 1.5s para não competir com outros modais de carregamento
            setTimeout(() => showVotingNotification(openVotings), 1500);
        }

        // Configurar realtime
        setupRealtimeSubscription();

        // Verificação periódica (a cada 1 minuto)
        if (notificationInterval) clearInterval(notificationInterval);
        notificationInterval = setInterval(async () => {
            const votings = await checkOpenVotings();
            if (votings.length > 0) {
                // Limpar cache para re-exibir se necessário
                const pendingMatches = votings.filter(m => !m.voted_best || !m.voted_worst);
                if (pendingMatches.length > 0) {
                    // Não mostrar modal automaticamente na verificação periódica
                    // Apenas atualizar o estado global
                    window._fmOpenVotings = votings;
                }
            } else {
                window._fmOpenVotings = [];
            }
        }, NOTIFICATION_CHECK_INTERVAL);
    }

    // Expor globalmente
    window.FMVotingNotification = {
        check: checkOpenVotings,
        show: showVotingNotification,
        init: initVotingNotification
    };

    // Auto-iniciar quando a página carregar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Delay para garantir que auth-guard e database.js inicializaram
            setTimeout(initVotingNotification, 1000);
        });
    } else {
        setTimeout(initVotingNotification, 1000);
    }
})();
