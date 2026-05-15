document.addEventListener("DOMContentLoaded", async () => {
  await initDB();

  const currentUser = JSON.parse(sessionStorage.getItem("currentUser"));
  const adminActionsDiv = document.getElementById("admin-actions");
  const adminActivityPanel = document.getElementById("admin-activity-panel");
  let lastLogTimestamp = null;

  if (currentUser && currentUser.role === "admin") {
    if (adminActionsDiv) adminActionsDiv.style.display = "flex";
    if (adminActivityPanel) adminActivityPanel.style.display = "block";

    const toggleActivityBtn = document.getElementById("toggle-activity-btn");
    const activityLogList = document.getElementById("activity-log-list");
    const activityLogListUl = activityLogList.querySelector("ul");

    toggleActivityBtn.addEventListener("click", () => {
      const isVisible = activityLogList.style.display === "block";
      activityLogList.style.display = isVisible ? "none" : "block";
      toggleActivityBtn.textContent = isVisible
        ? "Ver Atividade"
        : "Ocultar Atividade";
    });

    function showToast(message) {
      FMModal.fromRealtime({
        title: "Atividade recente",
        message,
      });
    }

    async function updateActivityLogs() {
      const logs = await getActivityLogs(5);
      activityLogListUl.innerHTML = "";
      if (logs.length > 0) {
        if (lastLogTimestamp && logs[0].timestamp > lastLogTimestamp) {
          showToast(`🔔 ${logs[0].username} acabou de entrar!`);
        }
        lastLogTimestamp = logs[0].timestamp;
        logs.forEach((log) => {
          const date = new Date(log.timestamp);
          const formattedTime = `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
          const li = document.createElement("li");
          li.textContent = `[${formattedTime}] ${log.username} entrou.`;
          activityLogListUl.appendChild(li);
        });
      } else {
        activityLogListUl.innerHTML = "<li>Nenhuma atividade recente.</li>";
      }
    }
    updateActivityLogs();
    setInterval(updateActivityLogs, 10000);
  }

  const matchListDiv = document.getElementById("match-list");
  let countdownIntervals = [];

  async function renderMatches() {
    countdownIntervals.forEach(clearInterval);
    countdownIntervals = [];
    matchListDiv.innerHTML = "";
    try {
      const matches = await getAllMatches();
      if (matches.length === 0) {
        matchListDiv.innerHTML = "<p>Nenhuma partida agendada no momento.</p>";
        return;
      }
      matches.sort(
        (a, b) =>
          new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time),
      );
      for (const match of matches) {
        const card = document.createElement("div");
        card.className = "match-card";
        card.classList.add(`status-${match.status.toLowerCase()}`);

        const matchDate = new Date(match.date + "T" + match.time);
        const options = {
          weekday: "long",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        };
        let formattedDate = matchDate.toLocaleDateString("pt-BR", options);
        formattedDate =
          formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

        const deleteButtonHTML =
          currentUser && currentUser.role === "admin"
            ? `<button class="btn btn-danger delete-button" data-match-id="${match.id}">Excluir</button>`
            : "";
        const editButtonHTML =
          currentUser && currentUser.role === "admin"
            ? `<button class="btn btn-secondary edit-button" data-match-id="${match.id}">Editar</button>`
            : "";
        const whatsappButtonHTML = `<button class="btn btn-confirm whatsapp-button" data-match-id="${match.id}">📱 WhatsApp do Admin</button>`;

        // Função para obter o link do Google Maps baseado no local
        function getLocationLink(location) {
          const locationMaps = {
            "Prime Fut 7": "https://maps.app.goo.gl/FH2FMGaBdBUtdhUT6",
            "Society Do Chocolate": "https://maps.app.goo.gl/vBnBYdzPNnCQ7msW7",
            Chocolate: "https://maps.app.goo.gl/vBnBYdzPNnCQ7msW7",
          };
          return locationMaps[location] || null;
        }

        // Gerar HTML do ícone de localização se houver link
        const locationLink = getLocationLink(match.location);
        const locationIconHTML = locationLink
          ? `<span class="location-icon" data-location-url="${locationLink}" style="cursor: pointer; margin-left: 5px; color: var(--accent-blue);" title="Ver localização no Google Maps">📍</span>`
          : "";

        let countdownHTML = "";
        const matchDateTime = new Date(`${match.date}T${match.time}`).getTime();
        const now = new Date().getTime();
        if (matchDateTime > now && match.status !== "CANCELADA") {
          countdownHTML = `
                    <div class="match-progress" id="countdown-${match.id}">
                        <div class="progress-label">
                            <span class="countdown-text">Calculando...</span>
                        </div>
                        <div class="progress-bar-container">
                            <div class="progress-bar"></div>
                        </div>
                    </div>`;
        }

        const teams = normalizeTeams(match.teams || []);
        const teamsHTML =
          teams.length > 0
            ? `<div class="match-teams-preview">${teams.length} time(s) cadastrado(s)${teams.length >= 3 ? " - Sorteio ativo" : ""}</div>
                       <div class="match-team-chips">
                           ${teams.map((team) => `<span class="match-team-chip" style="background: ${team.color}; color: #fff; border-color: ${team.color}; text-shadow: 0 1px 2px rgba(0,0,0,0.3);"><span class="team-dot" style="background: #fff; opacity: 0.5;"></span>${team.name}</span>`).join("")}
                       </div>`
            : "";

        card.innerHTML = `
                    <div class="match-card-header">
                        <span class="match-date">${formattedDate}</span>
                        <span class="match-status">${match.status}</span>
                    </div>
                    <p class="match-location">🏟️ ${match.location}${locationIconHTML}</p>
                    <p class="match-time">⏱️ Início às ${match.time}h</p>
                    <p class="match-price">💰 Coleta: R$ ${match.playerFee.toFixed(2).replace(".", ",")}</p>
                    ${teamsHTML}
                    <div class="confirmed-players">
                        <h4>👥 ${match.players.length} Jogadores na lista</h4>
                    </div>
                    ${countdownHTML}
                    <div class="match-card-footer">
                        <div class="match-actions">
                            ${whatsappButtonHTML}
                            ${editButtonHTML}
                            ${deleteButtonHTML}
                        </div>
                        <button class="btn btn-primary details-button" data-match-id="${match.id}">Ver Detalhes</button>
                    </div>`;

        matchListDiv.appendChild(card);

        if (matchDateTime > now && match.status !== "CANCELADA") {
          startCountdown(match.id, matchDateTime);
        }

        card.querySelector(".details-button").addEventListener("click", () => {
          sessionStorage.setItem("selectedMatchId", match.id);
          window.location.href = "details.html";
        });

        const deleteButton = card.querySelector(".delete-button");
        if (deleteButton) {
          deleteButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            const confirmed = await FMModal.confirm({
              type: "admin",
              title: "Excluir partida",
              message: `Tem certeza que deseja excluir a partida em "${match.location}"?`,
              confirmLabel: "Excluir",
              danger: true,
              priority: 80,
            });
            if (confirmed) {
              await deleteMatch(match.id);
              renderMatches();
            }
          });
        }

        const editButton = card.querySelector(".edit-button");
        if (editButton) {
          editButton.addEventListener("click", (event) => {
            event.stopPropagation();
            sessionStorage.setItem("editMatchId", match.id);
            window.location.href = "schedule.html"; // Redireciona para a página de agendamento para edição
          });
        }

        const whatsappButton = card.querySelector(".whatsapp-button");
        if (whatsappButton) {
          whatsappButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            const adminPhoneNumber = await getConfig("admin_whatsapp");
            if (adminPhoneNumber) {
              const message = `Olá Administrador! Gostaria de falar sobre a partida em ${match.location} no dia ${formattedDate} às ${match.time}h.`;
              const whatsappUrl = `https://api.whatsapp.com/send?phone=${adminPhoneNumber}&text=${encodeURIComponent(message)}`;
              window.open(whatsappUrl, "_blank");
            } else {
              FMModal.warning(
                "Numero do administrador nao configurado. Por favor, configure nas opcoes.",
              );
            }
          });
        }

        // Event listener para o ícone de localização
        const locationIcon = card.querySelector(".location-icon");
        if (locationIcon) {
          locationIcon.addEventListener("click", (event) => {
            event.stopPropagation();
            const locationUrl = locationIcon.getAttribute("data-location-url");
            if (locationUrl) {
              window.open(locationUrl, "_blank");
            }
          });
        }
      }
    } catch (error) {
      console.error("Erro ao renderizar partidas:", error);
      matchListDiv.innerHTML =
        "<p>Ocorreu um erro ao carregar as partidas.</p>";
    }
  }

  function startCountdown(matchId, matchDateTime) {
    const countdownContainer = document.getElementById(`countdown-${matchId}`);
    if (!countdownContainer) return;
    const countdownText = countdownContainer.querySelector(".countdown-text");
    const progressBar = countdownContainer.querySelector(".progress-bar");
    const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;
    const update = () => {
      const now = new Date().getTime();
      const distance = matchDateTime - now;
      if (distance < 0) {
        countdownText.textContent = "Partida em andamento!";
        progressBar.style.width = "100%";
        return;
      }
      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      if (days > 0) {
        countdownText.textContent = `Faltam ${days}d e ${hours}h`;
      } else if (hours > 0) {
        countdownText.textContent = `Faltam ${hours}h e ${minutes}m`;
      } else {
        countdownText.textContent = `Faltam ${minutes}m`;
      }
      const timeElapsed = sevenDaysInMillis - distance;
      const progressPercentage = Math.min(
        100,
        (timeElapsed / sevenDaysInMillis) * 100,
      );
      progressBar.style.width = `${progressPercentage}%`;
    };
    update();
    const interval = setInterval(update, 60000);
    countdownIntervals.push(interval);
  }

  // === CLASSIFICAÇÃO (STANDINGS) ===
  const standingsSelect = document.getElementById('dash-standings-select');
  const standingsContainer = document.getElementById('dash-standings-container');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function carregarCompeticoesStandings() {
    if (!standingsSelect) return;

    const client = getSupabaseClient();
    if (!client) {
      standingsSelect.innerHTML = '<option value="">— Indisponível —</option>';
      return;
    }

    const { data, error } = await client
      .from('fm_standings')
      .select('match_id')
      .order('updated_at', { ascending: false });

    if (error || !data || data.length === 0) {
      standingsSelect.innerHTML = '<option value="">— Nenhuma competição disponível —</option>';
      return;
    }

    const matchIds = [...new Set(data.map(d => d.match_id))];
    const matchTitles = {};

    if (matchIds.length > 0) {
      const client2 = getSupabaseClient();
      if (client2) {
        const { data: matches } = await client2
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
          const { data: liveMatches } = await client2
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
    }

    standingsSelect.innerHTML = '<option value="">— Escolha uma competição —</option>';
    matchIds.forEach(id => {
      const title = matchTitles[id] || id;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = title;
      standingsSelect.appendChild(option);
    });
  }

  async function carregarStandings(matchId) {
    if (!standingsContainer) return;

    const client = getSupabaseClient();
    if (!client) {
      standingsContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Serviço indisponível no momento.</p>';
      return;
    }

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
      standingsContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Erro ao carregar classificação.</p>';
      return;
    }

    if (!data || data.length === 0) {
      standingsContainer.innerHTML = `
        <div class="dash-standings-empty">
          <i class="fas fa-trophy"></i>
          Nenhuma classificação disponível para esta competição.
        </div>`;
      return;
    }

    renderStandingsTable(data);
  }

  function renderStandingsTable(standings) {
    if (!standingsContainer) return;

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
          <td><span class="standings-team-pill" style="background:${bg}">${escapeHtml(s.team_name)}</span></td>
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

    standingsContainer.innerHTML = `
      <div class="dash-standings-table-wrap">
        <table class="dash-standings-table">
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

  // Inicializa o select de competições e listener
  if (standingsSelect) {
    carregarCompeticoesStandings();

    standingsSelect.addEventListener('change', () => {
      const selectedId = standingsSelect.value;
      if (selectedId) {
        carregarStandings(selectedId);
      } else {
        standingsContainer.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px 0;font-size:0.85rem">Selecione uma competição para ver a classificação.</p>';
      }
    });
  }

  renderMatches();
});
