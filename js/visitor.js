/**
 * visitor.js
 * Sistema de Acesso para Visitantes
 * 
 * Permite acesso limitado ao sistema sem necessidade de cadastro completo.
 * Visitantes podem ver partidas, placar ao vivo, e informações públicas.
 * Visitantes NÃO podem: votar, sorteiar, administrar, editar, etc.
 */
document.addEventListener('DOMContentLoaded', () => {
    const visitorBtn = document.getElementById('visitor-btn');
    const visitorModal = document.getElementById('visitor-modal');
    const visitorForm = document.getElementById('visitor-form');
    const visitorCancel = document.getElementById('visitor-cancel');
    const visitorError = document.getElementById('visitor-error');
    const visitorBtnText = document.getElementById('visitor-btn-text');
    const visitorSubmit = document.getElementById('visitor-submit');

    if (!visitorBtn || !visitorModal || !visitorForm) return;

    // Abrir modal de visitante
    visitorBtn.addEventListener('click', () => {
        visitorModal.style.display = 'flex';
        const nameInput = document.getElementById('visitor-name');
        if (nameInput) nameInput.focus();
    });

    // Fechar modal
    visitorCancel.addEventListener('click', () => {
        visitorModal.style.display = 'none';
        visitorError.style.display = 'none';
    });

    // Fechar ao clicar no overlay
    visitorModal.addEventListener('click', (e) => {
        if (e.target === visitorModal) {
            visitorModal.style.display = 'none';
            visitorError.style.display = 'none';
        }
    });

    // Submit do formulário de visitante
    visitorForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('visitor-name').value.trim();
        const phone = document.getElementById('visitor-phone').value.trim().replace(/\D/g, '');

        if (!name || name.length < 2) {
            showVisitorError('Por favor, digite seu nome (mínimo 2 caracteres).');
            return;
        }

        visitorSubmit.disabled = true;
        visitorBtnText.textContent = 'Entrando...';
        visitorError.style.display = 'none';

        try {
            const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
            if (!client) {
                throw new Error('Erro de conexão. Recarregue a página.');
            }

            // 1. Criar conta anônima no Supabase Auth
            const { data: authData, error: authError } = await client.auth.signInAnonymously();

            if (authError) {
                console.error('Erro no login anônimo:', authError);
                throw new Error('Não foi possível criar acesso de visitante. Tente novamente.');
            }

            if (!authData?.user) {
                throw new Error('Sessão inválida. Tente novamente.');
            }

            // 2. Registrar perfil de visitante via RPC segura
            const { data: profileData, error: profileError } = await client.rpc('register_visitor', {
                p_name: name,
                p_phone: phone || null
            });

            if (profileError) {
                console.error('Erro ao registrar visitante:', profileError);
                throw new Error('Erro ao configurar perfil de visitante.');
            }

            // 3. Salvar sessão do visitante
            const visitorUser = {
                id: authData.user.id,
                username: profileData.username || ('visitante_' + Date.now()),
                full_name: name,
                email: null,
                phone: phone || null,
                role: 'visitor'
            };

            sessionStorage.setItem('currentUser', JSON.stringify(visitorUser));

            // 4. Registrar atividade
            if (typeof addActivityLog === 'function') {
                addActivityLog({ username: visitorUser.username, action: 'visitor_login' }).catch(() => {});
            }

            // 5. Redirecionar para a tela de boas-vindas
            window.location.href = 'pages/welcome.html';

        } catch (error) {
            console.error('Erro no acesso de visitante:', error);
            showVisitorError(error.message || 'Não foi possível entrar como visitante.');
            visitorSubmit.disabled = false;
            visitorBtnText.textContent = 'Entrar como Visitante';
        }
    });

    function showVisitorError(msg) {
        visitorError.textContent = msg;
        visitorError.style.display = 'block';
    }
});
