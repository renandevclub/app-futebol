document.addEventListener('DOMContentLoaded', async () => {
    await initDB();

    const selectedMatchId = sessionStorage.getItem('selectedMatchId');
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser'));

    // Seletores de elementos
    const matchHeaderInfo = document.getElementById('match-header-info');
    const totalRevenueEl = document.getElementById('total-revenue');
    const totalExpensesEl = document.getElementById('total-expenses');
    const finalBalanceEl = document.getElementById('final-balance');
    const expensesListEl = document.getElementById('expenses-list');
    const addExpenseFormSection = document.getElementById('add-expense-form').parentElement;
    
    // --- NOVOS ELEMENTOS ---
    const playerFeedbackSection = document.getElementById('player-feedback-section');
    const playerFeedbackForm = document.getElementById('player-feedback-form');

    if (!selectedMatchId || !currentUser) {
        document.body.innerHTML = 
            `<div style="text-align: center; padding: 50px;">
                <h1>Ops! Algo deu errado.</h1>
                <p>Não foi possível carregar os detalhes financeiros da partida.</p>
                <p>Por favor, certifique-se de ter selecionado uma partida na página de histórico.</p>
                <a href="dashboard.html" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #1a73e8; color: white; text-decoration: none; border-radius: 8px;">Ir para o Histórico de Partidas</a>
            </div>`;
        return;
    }

    const isAdmin = currentUser.role === 'admin';

    // Controla a visibilidade das seções com base no tipo de usuário
    if (isAdmin) {
        playerFeedbackSection.style.display = 'none'; // Esconde feedback de admin
    } else {
        addExpenseFormSection.style.display = 'none'; // Esconde formulário de jogador
        playerFeedbackSection.style.display = 'block'; // Jogador pode enviar dúvidas
    }

    let currentMatch;

    async function loadFinancialDetails() {
        try {
            currentMatch = await getMatchById(selectedMatchId);
            if (!currentMatch.financial_summary) {
                currentMatch.financial_summary = { expenses: [] };
            }
            renderPage();
        } catch (error) {
            console.error("Erro ao carregar dados financeiros:", error);
            document.body.innerHTML = '<h1>Erro ao carregar dados.</h1>';
        }
    }

    function renderPage() {
        // Formatando a data da partida
        const [year, month, day] = currentMatch.date.split('-');
        const formattedDate = `${day}/${month}/${year}`;
        
        // Criando o HTML melhorado para os detalhes da partida
        matchHeaderInfo.innerHTML = `
            <div class="match-detail-item">
                <span class="detail-label">📍 Local:</span>
                <span class="detail-value">${currentMatch.location}</span>
            </div>
            <div class="match-detail-item">
                <span class="detail-label">📅 Data:</span>
                <span class="detail-value">${formattedDate}</span>
            </div>
            <div class="match-detail-item">
                <span class="detail-label">💰 Valor por Jogador:</span>
                <span class="detail-value">R$ ${currentMatch.playerFee.toFixed(2).replace('.', ',')}</span>
            </div>
            <div class="match-detail-item">
                <span class="detail-label">👥 Jogadores Confirmados:</span>
                <span class="detail-value">${currentMatch.players.filter(p => p.confirmed).length}</span>
            </div>
            <div class="match-detail-item">
                <span class="detail-label">💳 Jogadores que Pagaram:</span>
                <span class="detail-value">${currentMatch.players.filter(p => p.paid).length}</span>
            </div>
        `;
        
        // Calculando os valores financeiros
        const revenue = currentMatch.players.filter(p => p.paid).length * currentMatch.playerFee;
        const totalExpenses = currentMatch.financial_summary.expenses.reduce((sum, exp) => sum + exp.value, 0);
        const balance = revenue - totalExpenses;
        
        // Atualizando os elementos da interface
        totalRevenueEl.textContent = `R$ ${revenue.toFixed(2).replace('.', ',')}`;
        totalExpensesEl.textContent = `R$ ${totalExpenses.toFixed(2).replace('.', ',')}`;
        finalBalanceEl.textContent = `R$ ${balance.toFixed(2).replace('.', ',')}`;
        finalBalanceEl.className = balance < 0 ? 'expenses' : 'revenue';
        
        renderExpensesList();
    }

    function renderExpensesList() {
        // ... (função renderExpensesList inalterada)
        expensesListEl.innerHTML = '';
        if (currentMatch.financial_summary.expenses.length === 0) {
            expensesListEl.innerHTML = '<p>Nenhuma despesa registrada.</p>';
            return;
        }
        currentMatch.financial_summary.expenses.forEach((expense, index) => {
            const expenseItem = document.createElement('div');
            expenseItem.className = 'expense-item-row';
            const deleteButtonHTML = isAdmin ? `<button class="delete-expense-btn" data-index="${index}">✖</button>` : '';
            expenseItem.innerHTML = `<span>${expense.description}</span><div class="expense-item-right"><strong>R$ ${expense.value.toFixed(2).replace('.', ',')}</strong>${deleteButtonHTML}</div>`;
            expensesListEl.appendChild(expenseItem);
        });
        if (isAdmin) {
            document.querySelectorAll('.delete-expense-btn').forEach(btn => btn.addEventListener('click', handleDeleteExpense));
        }
    }

    // --- LÓGICA DE ADMIN (inalterada) ---
    async function handleAddExpense(event) { /* ...código inalterado... */ }
    async function handleDeleteExpense(event) { /* ...código inalterado... */ }

    // --- NOVA LÓGICA DE FEEDBACK DO JOGADOR ---
    async function handlePlayerFeedback(event) {
        event.preventDefault();
        const message = document.getElementById('feedback-message').value;
        if (!message.trim()) {
            FMModal.warning("Por favor, escreva sua duvida ou observacao.");
            return;
        }

        const adminPhoneNumber = await getConfig('admin_whatsapp');
        if (adminPhoneNumber) {
            const fullMessage = `*Dúvida Financeira da Partida!*\n\n` +
                                `*Partida:* ${currentMatch.location}\n` +
                                `*Jogador:* ${currentUser.username}\n\n` +
                                `*Mensagem:* "${message}"`;
            
            const whatsappUrl = `https://api.whatsapp.com/send?phone=${adminPhoneNumber}&text=${encodeURIComponent(fullMessage)}`;
            window.open(whatsappUrl, '_blank');
            playerFeedbackForm.reset();
        } else {
            FMModal.warning("Nao foi possivel encontrar o numero do administrador. Acao cancelada.");
        }
    }

    // Adiciona os event listeners corretos para cada tipo de usuário
    if (isAdmin) {
        document.getElementById('add-expense-form').addEventListener('submit', handleAddExpense);
    } else {
        if (playerFeedbackForm) {
            playerFeedbackForm.addEventListener('submit', handlePlayerFeedback);
        }
    }
    // --- CÓDIGO COMPLETO DAS FUNÇÕES DE ADMIN INALTERADAS ---
    async function handleAddExpense(event) {
        event.preventDefault();
        const description = document.getElementById('expense-description').value;
        const value = parseFloat(document.getElementById('expense-value').value);

        if (!description.trim() || isNaN(value) || value <= 0) {
            FMModal.warning("Por favor, preencha a descricao e um valor valido.");
            return;
        }

        currentMatch.financial_summary.expenses.push({ description, value });
        try {
            await addMatch(currentMatch);
            document.getElementById('add-expense-form').reset();
            renderPage();
        } catch (error) {
            console.error("Erro ao adicionar despesa:", error);
            FMModal.error("Nao foi possivel adicionar a despesa.");
        }
    }
    async function handleDeleteExpense(event) {
        const indexToDelete = parseInt(event.target.dataset.index, 10);
        const confirmed = await FMModal.confirm({
            type: 'admin',
            title: 'Excluir despesa',
            message: 'Tem certeza que deseja excluir esta despesa?',
            confirmLabel: 'Excluir',
            danger: true,
            priority: 70
        });

        if (!confirmed) return;

        currentMatch.financial_summary.expenses.splice(indexToDelete, 1);
        try {
            await addMatch(currentMatch);
            renderPage();
        } catch (error) {
            console.error("Erro ao excluir despesa:", error);
            FMModal.error("Nao foi possivel excluir a despesa.");
        }
    }

    loadFinancialDetails();
});
