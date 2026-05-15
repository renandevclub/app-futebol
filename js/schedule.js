document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    const currentUser = await requireAdmin();
    if (!currentUser) return;

    const scheduleForm = document.getElementById('schedule-form');
    const locationSelect = document.getElementById('match-location');
    const locationCustomInput = document.getElementById('match-location-custom');
    const teamsList = document.getElementById('match-teams-list');
    const addTeamBtn = document.getElementById('add-team-btn');
    const submitBtn = scheduleForm.querySelector('button[type="submit"]');
    const pageTitle = document.querySelector('.schedule-header h1');
    const editMatchId = sessionStorage.getItem('editMatchId');

    let editingMatch = null;
    let teamDraft = [];

    function createTeamDraft(name = '', id = null, color = null, icon = null) {
        return {
            id: id || generateId('team'),
            name,
            color,
            icon
        };
    }

    function renderTeamInputs() {
        teamsList.innerHTML = '';

        if (teamDraft.length === 0) {
            teamsList.innerHTML = '<div class="teams-empty-state">Nenhum time cadastrado.</div>';
            return;
        }

        teamDraft.forEach((team, index) => {
            const position = index + 1;
            // Pegar a cor padronizada da constante global TEAM_DEFAULT_STYLES definida em database.js
            const defaultStyle = (typeof TEAM_DEFAULT_STYLES !== 'undefined')
                ? TEAM_DEFAULT_STYLES[(position - 1) % TEAM_DEFAULT_STYLES.length]
                : { color: '#10b981' };
            const teamColor = team.color || defaultStyle.color;

            const row = document.createElement('div');
            row.className = 'team-input-row';
            
            // Injetando as cores inline mantendo o design:
            // background com 15% de opacidade (24 em hex), borda com 30% de opacidade (4D em hex)
            row.innerHTML = `
                <span class="team-index" style="background: ${teamColor}24; border-color: ${teamColor}4D; color: ${teamColor};">${position}</span>
                <input type="text" class="team-name-input" value="${team.name || ''}" placeholder="Nome do time">
                <button type="button" class="btn-remove-team" title="Remover time">Remover</button>
            `;

            row.querySelector('.team-name-input').addEventListener('input', (event) => {
                teamDraft[index].name = event.target.value;
            });

            row.querySelector('.btn-remove-team').addEventListener('click', () => {
                teamDraft.splice(index, 1);
                renderTeamInputs();
            });

            teamsList.appendChild(row);
        });
    }

    function getTeamsFromDraft() {
        return normalizeTeams(teamDraft.map(team => ({
            id: team.id,
            name: team.name,
            color: team.color || null,
            icon: team.icon || null
        })));
    }

    function syncPlayersWithTeams(players, teams) {
        const teamMap = new Map(teams.map(team => [team.id, team]));

        return (players || []).map(player => {
            if (!player?.teamId) return player;

            const team = teamMap.get(player.teamId);
            if (!team) {
                const { teamId, teamName, ...rest } = player;
                return { ...rest, assignmentMode: 'manual' };
            }

            return { ...player, teamName: team.name };
        });
    }

    function syncDrawsWithTeams(draws, teams) {
        const teamMap = new Map(teams.map(team => [team.id, team]));
        const nextDraws = {};

        Object.entries(draws || {}).forEach(([key, draw]) => {
            const team = teamMap.get(draw?.teamId);
            nextDraws[key] = team ? { ...draw, teamName: team.name } : draw;
        });

        return nextDraws;
    }

    function fillLocation(location) {
        const hasOption = Array.from(locationSelect.options).some(option => option.value === location);
        if (hasOption) {
            locationSelect.value = location;
            locationCustomInput.style.display = 'none';
            locationCustomInput.required = false;
            locationCustomInput.value = '';
            return;
        }

        locationSelect.value = 'Outro';
        locationCustomInput.style.display = 'block';
        locationCustomInput.required = true;
        locationCustomInput.value = location || '';
    }

    async function loadEditMatch() {
        if (!editMatchId) {
            renderTeamInputs();
            return;
        }

        try {
            editingMatch = await getMatchById(editMatchId);
            if (!editingMatch) {
                sessionStorage.removeItem('editMatchId');
                renderTeamInputs();
                return;
            }

            if (pageTitle) pageTitle.textContent = '⚽ Editar Partida';
            if (submitBtn) submitBtn.textContent = '💾 Salvar Alterações';

            document.getElementById('match-title').value = editingMatch.title || '';
            document.getElementById('match-date').value = editingMatch.date || '';
            document.getElementById('match-time').value = editingMatch.time || '';
            document.getElementById('match-fee').value = Number(editingMatch.playerFee || 0).toFixed(2);
            document.getElementById('match-notes').value = editingMatch.notes || '';
            fillLocation(editingMatch.location || '');

            teamDraft = normalizeTeams(editingMatch.teams || []).map(team => (
                createTeamDraft(team.name, team.id, team.color, team.icon)
            ));
            renderTeamInputs();
        } catch (error) {
            console.error('Erro ao carregar partida para edição:', error);
            FMModal.error('Nao foi possivel carregar a partida para edicao.');
            sessionStorage.removeItem('editMatchId');
            renderTeamInputs();
        }
    }

    locationSelect.addEventListener('change', () => {
        if (locationSelect.value === 'Outro') {
            locationCustomInput.style.display = 'block';
            locationCustomInput.required = true;
        } else {
            locationCustomInput.style.display = 'none';
            locationCustomInput.required = false;
            locationCustomInput.value = '';
        }
    });

    addTeamBtn.addEventListener('click', () => {
        teamDraft.push(createTeamDraft());
        renderTeamInputs();
    });

    scheduleForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        let finalLocation = locationSelect.value;
        if (finalLocation === 'Outro') {
            finalLocation = locationCustomInput.value.trim();
        }

        const teams = getTeamsFromDraft();
        const previousDraws = normalizeTeamDraws(editingMatch?.teamDraws || editingMatch?.team_draws || {});

        const newMatch = {
            id: editingMatch?.id || `match_${new Date().getTime()}`,
            title: document.getElementById('match-title').value.trim(),
            date: document.getElementById('match-date').value,
            time: document.getElementById('match-time').value,
            location: finalLocation,
            playerFee: parseFloat(document.getElementById('match-fee').value),
            notes: document.getElementById('match-notes').value,
            status: editingMatch?.status || 'AGENDADA',
            players: syncPlayersWithTeams(editingMatch?.players || [], teams),
            teams,
            teamDraws: syncDrawsWithTeams(previousDraws, teams),
            votes: editingMatch?.votes || { best_player: [], worst_player: [] },
            financial_summary: editingMatch?.financial_summary || { expenses: [] },
            results_processed: Boolean(editingMatch?.results_processed),
            voting_deadline: editingMatch?.voting_deadline || null
        };

        if (!newMatch.date || !newMatch.time || !newMatch.location || isNaN(newMatch.playerFee)) {
            FMModal.warning('Por favor, preencha todos os campos obrigatorios (Data, Horario, Local e Valor).');
            return;
        }

        try {
            await addMatch(newMatch);

            const successMessage = editingMatch ? 'Partida atualizada com sucesso!' : 'Partida agendada com sucesso!';
            const notify = !editingMatch && await FMModal.confirm({
                type: 'admin',
                title: 'Preparar notificacao',
                message: `${successMessage} Deseja preparar a notificacao para o grupo?`,
                confirmLabel: 'Preparar',
                cancelLabel: 'Agora nao',
                priority: 60
            });

            if (notify) {
                const adminPhoneNumber = await getConfig('admin_whatsapp');
                if (adminPhoneNumber) {
                    const [year, month, day] = newMatch.date.split('-');
                    const formattedDate = `${day}/${month}/${year}`;
                    const teamsLine = newMatch.teams.length > 0
                        ? `*Times:* ${newMatch.teams.map(team => team.name).join(', ')}\n`
                        : '';

                    const message = `📢 *Nova Partida Agendada!* 📢\n\n` +
                        `*Data:* ${formattedDate} - ${newMatch.time}h\n` +
                        `*Local:* ${newMatch.location}\n` +
                        teamsLine +
                        `*Valor:* R$ ${newMatch.playerFee.toFixed(2).replace('.', ',')}\n\n` +
                        `*Acesse o app para confirmar sua presença!*`;

                    const whatsappUrl = `https://api.whatsapp.com/send?phone=${adminPhoneNumber}&text=${encodeURIComponent(message)}`;

                    FMModal.success('A mensagem para o grupo esta pronta. Envie para voce mesmo e depois encaminhe para o grupo!');
                    window.open(whatsappUrl, '_blank');
                } else {
                    FMModal.warning('Numero do administrador nao encontrado nas configuracoes.');
                }
            }

            if (editingMatch) {
                FMModal.success(successMessage);
            }

            sessionStorage.removeItem('editMatchId');
            window.location.href = 'dashboard.html';
        } catch (error) {
            console.error('Erro ao salvar partida:', error);
            FMModal.error(error?.message || 'Ocorreu um erro ao salvar a partida. Tente novamente.');
        }
    });

    await loadEditMatch();
});
