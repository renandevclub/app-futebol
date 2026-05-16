document.addEventListener("DOMContentLoaded", async () => {
  await initDB();
  const selectedMatchId = sessionStorage.getItem("selectedMatchId");
  const currentUser = JSON.parse(sessionStorage.getItem("currentUser"));

  const mainContainer = document.querySelector(".details-container");
  const pageTitle = document.getElementById("page-header-title");
  const actionButtonsContainer = document.querySelector(".action-buttons");
  const adminControlsSection = document.getElementById("admin-controls");
  const votingSection = document.getElementById("voting-section");
  let currentMatch;
  let countdownInterval;
  let scratchCardState = { hasChosen: false, chosenIndex: -1 };
  let matchRealtimeChannel = null;

  function unsubscribeMatchRealtime() {
    if (
      matchRealtimeChannel &&
      typeof matchRealtimeChannel.unsubscribe === "function"
    ) {
      matchRealtimeChannel.unsubscribe().catch((error) => {
        console.warn("Erro ao cancelar inscrição realtime:", error);
      });
    }
    matchRealtimeChannel = null;
  }

  function setupMatchRealtimeSubscription(matchId) {
    const client =
      typeof getSupabaseClient === "function" ? getSupabaseClient() : null;
    if (!client || typeof client.channel !== "function") return;

    unsubscribeMatchRealtime();
    matchRealtimeChannel = client.channel(`match_updates_${matchId}`);

    matchRealtimeChannel
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fm_matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (payload?.new) {
            currentMatch = normalizeMatchFromSupabase(payload.new);
            renderAllSections();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "fm_matches",
          filter: `id=eq.${matchId}`,
        },
        async () => {
          await FMModal.system({
            title: "Partida alterada em tempo real",
            message:
              "A partida foi removida ou alterada. Recarregue a pagina para ver o estado atualizado.",
            source: "realtime",
            priority: 100,
          });
          window.location.reload();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Inscrição realtime ativa para partida:", matchId);
        }
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          console.warn("Inscrição realtime da partida falhou:", status);
        } else if (status === "CLOSED") {
          console.log("Inscrição realtime da partida fechada normalmente.");
        }
      });
  }

  const SCRATCH_COLORS = [
    { hex: "#f59e0b", rgb: "245,158,11" }, // Dourado
    { hex: "#8b5cf6", rgb: "139,92,246" }, // Roxo
    { hex: "#f97316", rgb: "249,115,22" }, // Laranja
    { hex: "#06b6d4", rgb: "6,182,212" }, // Ciano
    { hex: "#ec4899", rgb: "236,72,153" }, // Rosa
    { hex: "#84cc16", rgb: "132,204,22" }, // Lima
  ];

  function hexToRgb(hex) {
    if (!hex || typeof hex !== "string") return "107,114,128";
    const sanitized = hex.replace("#", "").trim();
    if (sanitized.length === 3) {
      const [r, g, b] = sanitized.split("");
      return `${parseInt(r + r, 16)},${parseInt(g + g, 16)},${parseInt(b + b, 16)}`;
    }
    if (sanitized.length !== 6) return "107,114,128";
    const intVal = parseInt(sanitized, 16);
    const r = (intVal >> 16) & 255;
    const g = (intVal >> 8) & 255;
    const b = intVal & 255;
    return `${r},${g},${b}`;
  }

  function getScratchColor(colorHexOrIndex) {
    if (typeof colorHexOrIndex === "string") {
      return { hex: colorHexOrIndex, rgb: hexToRgb(colorHexOrIndex) };
    }
    const index = Number.isInteger(colorHexOrIndex) ? colorHexOrIndex : 0;
    return SCRATCH_COLORS[index % SCRATCH_COLORS.length];
  }

  function getMatchTeams() {
    return normalizeTeams(currentMatch?.teams || []);
  }

  function isScratchCardEnabled() {
    return getMatchTeams().length >= 3;
  }

  function getDrawKey(username) {
    return normalizeTeamKey(username);
  }

  function getCurrentUserDraw() {
    const draws = normalizeTeamDraws(
      currentMatch?.teamDraws || currentMatch?.team_draws || {},
    );
    return draws[getDrawKey(currentUser?.username)] || null;
  }

  function getTeamById(teamId) {
    return getMatchTeams().find((team) => team.id === teamId) || null;
  }

  function getPlayerTeamLabel(player) {
    if (player.teamName) return player.teamName;
    const team = getTeamById(player.teamId);
    return team?.name || "";
  }

  function getMatchPlayer(username) {
    const usernameKey = getDrawKey(username);
    return (
      currentMatch.players.find(
        (player) => getDrawKey(player?.username) === usernameKey,
      ) || null
    );
  }

  function playerCanDrawAgain(player) {
    return Boolean(
      player && isScratchCardEnabled() && !getPlayerTeamLabel(player),
    );
  }

  function createTeamOptions(selectedTeamId = "") {
    const options = ['<option value="">Sem time</option>'];
    getMatchTeams().forEach((team) => {
      const selected = team.id === selectedTeamId ? "selected" : "";
      options.push(
        `<option value="${team.id}" ${selected}>${team.name}</option>`,
      );
    });
    return options.join("");
  }

  if (!selectedMatchId || !currentUser) {
    mainContainer.innerHTML = `<div style="text-align: center; padding: 50px;">
                <h1>Ops! Algo deu errado.</h1>
                <p>Não foi possível carregar os detalhes da partida.</p>
                <p>Por favor, certifique-se de ter selecionado uma partida na página de histórico.</p>
                <a href="dashboard.html" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #1a73e8; color: white; text-decoration: none; border-radius: 8px;">Ir para o Histórico de Partidas</a>
            </div>`;
    return;
  }

  async function loadAndRenderPage() {
    try {
      currentMatch = await getMatchById(selectedMatchId);
      currentMatch.teams = normalizeTeams(currentMatch.teams || []);
      currentMatch.teamDraws = normalizeTeamDraws(
        currentMatch.teamDraws || currentMatch.team_draws || {},
      );
      currentMatch.players = Array.isArray(currentMatch.players)
        ? currentMatch.players
        : [];
      currentMatch.votes = currentMatch.votes || {
        best_player: [],
        worst_player: [],
      };
      currentMatch.votes.best_player = currentMatch.votes.best_player || [];
      currentMatch.votes.worst_player = currentMatch.votes.worst_player || [];

      // Busca votos em tempo real da tabela segura (fm_match_votes) para evitar Race Conditions
      const client =
        typeof getSupabaseClient === "function"
          ? getSupabaseClient()
          : window.supabaseClient;
      if (client) {
        const { data: voteData, error: voteError } = await client
          .from("fm_match_votes")
          .select("category, voter_username, candidate_username")
          .eq("match_id", currentMatch.id);

        if (!voteError && voteData) {
          currentMatch.votes.best_player = voteData
            .filter((v) => v.category === "best_player")
            .map((v) => ({
              voter: v.voter_username,
              candidate: v.candidate_username,
            }));
          currentMatch.votes.worst_player = voteData
            .filter((v) => v.category === "worst_player")
            .map((v) => ({
              voter: v.voter_username,
              candidate: v.candidate_username,
            }));
        }
      }

      // ================================================================
      // SEGURANÇA: Consulta o status REAL do sorteio no servidor
      // Isso garante que mesmo após refresh/limpar cache/trocar dispositivo,
      // o jogador sempre veja o mesmo time (registro imutável no banco)
      // ================================================================
      if (currentUser && isScratchCardEnabled()) {
        try {
          const serverStatus = await getPlayerDrawStatus(selectedMatchId);

          if (serverStatus && serverStatus.has_draw) {
            const drawKey = getDrawKey(currentUser.username);
            const serverTeamId = serverStatus.team_id;
            const serverTeamName = serverStatus.team_name;
            const existingPlayer = getMatchPlayer(currentUser.username);

            if (!existingPlayer) {
              console.warn(
                "Draw ativo encontrado no servidor, mas jogador nao esta na lista de players. " +
                  "Possivel inconsistencia - removendo draw orfao.",
              );
              try {
                const client =
                  typeof getSupabaseClient === "function"
                    ? getSupabaseClient()
                    : null;
                if (client) {
                  await client.rpc("admin_release_player_draw", {
                    p_match_id: selectedMatchId,
                    p_player_username: currentUser.username,
                    p_release_reason:
                      "Draw orfao - jogador nao consta na lista de confirmados.",
                  });
                }
              } catch (e) {
                console.warn("Nao foi possivel liberar draw orfao:", e);
              }
            } else if (
              !existingPlayer.teamId ||
              existingPlayer.teamId !== serverTeamId
            ) {
              existingPlayer.teamId = serverTeamId;
              existingPlayer.teamName = serverTeamName;
              existingPlayer.assignmentMode = "draw";
              existingPlayer.drawnAt = serverStatus.drawn_at;
            }

            if (
              !currentMatch.teamDraws[drawKey] ||
              currentMatch.teamDraws[drawKey].teamId !== serverTeamId
            ) {
              currentMatch.teamDraws[drawKey] = {
                teamId: serverTeamId,
                teamName: serverTeamName,
                username: currentUser.username,
                drawnAt: serverStatus.drawn_at,
              };
            }

            if (existingPlayer) {
              console.log("Sorteio recuperado do servidor:", serverTeamName);
            }
          } else if (serverStatus && serverStatus.was_released) {
            console.log("Admin liberou novo sorteio para este jogador");
            const existingPlayer = getMatchPlayer(currentUser.username);
            if (existingPlayer) {
              delete existingPlayer.teamId;
              delete existingPlayer.teamName;
              delete existingPlayer.assignmentMode;
              delete existingPlayer.drawnAt;
            }
            const drawKey = getDrawKey(currentUser.username);
            if (currentMatch.teamDraws[drawKey]) {
              delete currentMatch.teamDraws[drawKey];
            }
          }
        } catch (statusError) {
          console.warn(
            "Não foi possível verificar status do sorteio no servidor:",
            statusError,
          );
          // Continua com os dados locais (modo degradado)
        }
      }

      pageTitle.textContent = `Detalhes: ${currentMatch.location}`;
      if (
        currentMatch.status === "ENCERRADA" &&
        !currentMatch.results_processed &&
        new Date() > new Date(currentMatch.voting_deadline)
      ) {
        await processVotingResults(currentMatch);
        currentMatch = await getMatchById(selectedMatchId);
      }
      renderAllSections();
      setupMatchRealtimeSubscription(currentMatch.id);
    } catch (error) {
      console.error("Erro fatal ao carregar detalhes:", error);
      mainContainer.innerHTML = `<div class="card"><h2>Erro ao Carregar Partida</h2><p>Ocorreu um erro. Tente recarregar.</p></div>`;
    }
  }

  function renderAllSections() {
    renderMatchDetailsInfo();
    renderPlayerList();
    renderFinancialSummary();
    renderActionButtons();
    renderAdminControls();
    renderVotingSection();
    renderFinancialsButton();
  }

  function renderMatchDetailsInfo() {
    const container = document.getElementById("match-info");
    const [year, month, day] = currentMatch.date.split("-");

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
    const locationLink = getLocationLink(currentMatch.location);

    let statusBadgeStyle = "";
    switch (currentMatch.status) {
      case "CONFIRMADA":
        statusBadgeStyle =
          "background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3);";
        break;
      case "AGENDADA":
        statusBadgeStyle =
          "background: rgba(59,130,246,0.15); color: #93c5fd; border: 1px solid rgba(59,130,246,0.3);";
        break;
      case "CANCELADA":
        statusBadgeStyle =
          "background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3);";
        break;
      case "ENCERRADA":
        statusBadgeStyle =
          "background: rgba(100,116,139,0.15); color: var(--text-secondary); border: 1px solid rgba(100,116,139,0.3);";
        break;
      default:
        statusBadgeStyle =
          "background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2);";
    }

    const teams = getMatchTeams();
    const teamsSummaryHTML =
      teams.length > 0
        ? `
            <div class="match-teams-summary">
                <div class="match-teams-summary-header">
                    <strong>Times da partida</strong>
                    ${teams.length >= 3 ? '<span class="scratch-enabled-badge">🎟️ Sorteio ativo</span>' : ""}
                </div>
                <div class="match-team-chips">
                    ${teams.map((team) => `<span class="match-team-chip" style="background: ${team.color}; color: #fff; border-color: ${team.color}; text-shadow: 0 1px 2px rgba(0,0,0,0.3);"><span class="team-dot" style="background: #fff; opacity: 0.5;"></span>${team.name}</span>`).join("")}
                </div>
            </div>
        `
        : "";

    container.innerHTML = `
            <div class="match-card-header" style="display: flex; justify-content: space-between; align-items: center; padding:0; margin-bottom:20px;">
                <h3 style="margin: 0; font-size: 1.3rem;">Informações da Partida</h3>
                <span style="padding: 6px 14px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; ${statusBadgeStyle}">${currentMatch.status}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px;">
                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 14px;">
                    <div style="font-size: 1.8rem; flex-shrink: 0;">🗓️</div>
                    <div>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Data</p>
                        <p style="margin: 0; font-weight: 700; color: var(--text-main); font-size: 1.1rem; margin-top: 2px;">${day}/${month}/${year}</p>
                    </div>
                </div>
                
                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 14px;">
                    <div style="font-size: 1.8rem; flex-shrink: 0;">⏱️</div>
                    <div>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Horário</p>
                        <p style="margin: 0; font-weight: 700; color: var(--text-main); font-size: 1.1rem; margin-top: 2px;">${currentMatch.time}h</p>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 14px;">
                    <div style="font-size: 1.8rem; flex-shrink: 0;">💰</div>
                    <div>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Valor Coleta</p>
                        <p style="margin: 0; font-weight: 700; color: var(--accent-green); font-size: 1.1rem; margin-top: 2px;">R$ ${currentMatch.playerFee.toFixed(2).replace(".", ",")}</p>
                    </div>
                </div>
                
                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; align-items: center; gap: 14px;">
                    <div style="font-size: 1.8rem; flex-shrink: 0; cursor: ${locationLink ? "pointer" : "default"};" class="location-icon" data-location-url="${locationLink || ""}">🏟️</div>
                    <div>
                        <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">Local</p>
                        <p style="margin: 0; font-weight: 700; color: var(--text-main); font-size: 1rem; margin-top: 2px; line-height: 1.2;">${currentMatch.location}</p>
                        ${locationLink ? `<a href="${locationLink}" target="_blank" style="font-size: 0.75rem; color: var(--accent-blue); text-decoration: none; margin-top:4px; display:inline-block; font-weight: 600;">Ver no Mapa 📍</a>` : ""}
                    </div>
                </div>
            </div>

            <div class="notes" style="background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02)); padding: 18px; border-radius: var(--radius-sm); border-left: 4px solid var(--accent-blue); margin-top: 15px;">
                <strong style="color: var(--accent-blue); display:flex; align-items:center; gap:8px; font-size: 1.05rem;">ℹ️ Observações:</strong>
                <p style="margin-top: 8px; margin-bottom: 0; color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6;">${currentMatch.notes || "Nenhuma observação."}</p>
            </div>
            ${teamsSummaryHTML}`;

    // Event listener para o ícone de localização
    const locationIcon = container.querySelector(".location-icon");
    if (locationIcon && locationIcon.getAttribute("data-location-url")) {
      locationIcon.addEventListener("click", (event) => {
        event.stopPropagation();
        const locationUrl = locationIcon.getAttribute("data-location-url");
        if (locationUrl) {
          window.open(locationUrl, "_blank");
        }
      });
    }
  }

  async function renderPlayerList() {
    const container = document.getElementById("player-list");
    container.innerHTML = "";
    if (currentMatch.players.length === 0) {
      container.innerHTML =
        '<p style="color:#64748b;text-align:center;padding:20px 0;">Nenhum jogador confirmado ainda.</p>';
      return;
    }
    const isAdmin = currentUser.role === "admin";
    const client =
      typeof getSupabaseClient === "function" ? getSupabaseClient() : null;

    // Separar jogadores por status
    const confirmedPlayers = currentMatch.players.filter(
      (p) => p.status !== "withdrew" && p.status !== "removed",
    );
    const withdrawnPlayers = currentMatch.players.filter(
      (p) => p.status === "withdrew",
    );

    // Agrupar jogadores confirmados por time
    const playersByTeam = {};
    for (const player of confirmedPlayers) {
      const teamLabel = getPlayerTeamLabel(player) || "Sem Time";
      if (!playersByTeam[teamLabel]) {
        playersByTeam[teamLabel] = [];
      }
      playersByTeam[teamLabel].push(player);
    }

    // Ordenar: times reais primeiro (alfabeticamente), "Sem Time" por último
    const sortedTeams = Object.keys(playersByTeam).sort((a, b) => {
      if (a === "Sem Time") return 1;
      if (b === "Sem Time") return -1;
      return a.localeCompare(b);
    });

    const chevronSVG =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

    for (const teamLabel of sortedTeams) {
      const teamPlayers = playersByTeam[teamLabel];

      // Calcular cor e metadados
      let teamColor = "#64748b";
      let teamIcon = "⏳";
      if (teamLabel !== "Sem Time") {
        teamIcon = "🛡️";
        const samplePlayer = teamPlayers.find((p) => p.teamId);
        if (samplePlayer && samplePlayer.teamId) {
          const teamData = getTeamById(samplePlayer.teamId);
          if (teamData && teamData.color) teamColor = teamData.color;
        } else {
          teamColor = "#3b82f6";
        }
      }

      const paidCount = teamPlayers.filter((p) => p.paid).length;
      const pendingCount = teamPlayers.length - paidCount;
      const pendingValue = pendingCount * currentMatch.playerFee;
      const metaText =
        pendingCount > 0
          ? `${teamPlayers.length} jogadores <span class="acc-dot"></span> R$ ${pendingValue.toFixed(2).replace(".", ",")} pendente`
          : `${teamPlayers.length} jogadores <span class="acc-dot"></span> Todos pagos ✓`;

      // Accordion container
      const accordion = document.createElement("div");
      accordion.className = "team-accordion";

      // Para cores muito escuras (preto, cinza escuro), usar uma versão mais clara para bordas
      const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
          ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
            }
          : { r: 100, g: 100, b: 100 };
      };
      const rgb = hexToRgb(teamColor);
      const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
      const isDark = brightness < 80;

      // Accordion: borda lateral forte na cor do time + fundo sutil
      accordion.style.cssText = `border-left: 4px solid ${teamColor}; background: rgba(${rgb.r},${rgb.g},${rgb.b},0.08);`;

      // Header: gradient idêntico à imagem (escuro na esquerda, cor do time na direita)
      const header = document.createElement("div");
      header.className = "team-accordion-header";
      
      // O gradient vai do cinza bem escuro (base do app) até a cor do time na direita
      const headerBg = `linear-gradient(90deg, #1e2128 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85) 100%)`;
      
      header.style.cssText = `background: ${headerBg}; border-radius: 11px 11px 0 0; border-bottom: 1px solid rgba(255,255,255,0.05);`;
      header.innerHTML = `
                <div class="team-acc-info">
                    <div class="team-acc-name" style="color:#fff;font-weight:800;letter-spacing:0.5px;text-shadow:0 1px 2px rgba(0,0,0,0.5);">${teamLabel}</div>
                    <div class="team-acc-meta" style="color:rgba(255,255,255,0.7);">${metaText}</div>
                </div>
                <div class="team-acc-right">
                    <div class="team-acc-count" style="background:rgba(0,0,0,0.25);color:#fff;font-weight:800;">${teamPlayers.length}</div>
                    <div class="team-acc-chevron" style="color:rgba(255,255,255,0.7);">${chevronSVG}</div>
                </div>
            `;
      accordion.appendChild(header);

      // Body (collapsed by default)
      const body = document.createElement("div");
      body.className = "team-accordion-body";
      const bodyInner = document.createElement("div");
      bodyInner.className = "team-accordion-body-inner";

      for (const player of teamPlayers) {
        const playerEl = await buildPlayerElement(player, isAdmin, client);
        playerEl.style.marginBottom = "0";
        bodyInner.appendChild(playerEl);
      }

      body.appendChild(bodyInner);
      accordion.appendChild(body);

      // Click handler — accordion behavior
      header.addEventListener("click", () => {
        const isOpen = accordion.classList.contains("accordion-open");

        // Fechar todos os outros accordions (somente 1 aberto por vez)
        container
          .querySelectorAll(".team-accordion.accordion-open")
          .forEach((other) => {
            if (other !== accordion) {
              other.classList.remove("accordion-open");
            }
          });

        // Toggle do accordion clicado
        accordion.classList.toggle("accordion-open", !isOpen);
      });

      container.appendChild(accordion);
    }

    // Renderizar seção de desistentes (se houver)
    if (withdrawnPlayers.length > 0) {
      const withdrawnAccordion = document.createElement("div");
      withdrawnAccordion.className = "team-accordion";
      withdrawnAccordion.style.borderColor = "rgba(239,68,68,0.15)";

      const withdrawnHeader = document.createElement("div");
      withdrawnHeader.className = "team-accordion-header";
      withdrawnHeader.innerHTML = `
                <div class="team-acc-icon" style="background:rgba(239,68,68,0.12);color:#f87171;">⚠️</div>
                <div class="team-acc-info">
                    <div class="team-acc-name" style="color:#fca5a5;">Desistentes</div>
                    <div class="team-acc-meta">${withdrawnPlayers.length} jogador${withdrawnPlayers.length > 1 ? "es" : ""}</div>
                </div>
                <div class="team-acc-right">
                    <div class="team-acc-count" style="background:rgba(239,68,68,0.15);color:#f87171;">${withdrawnPlayers.length}</div>
                    <div class="team-acc-chevron">${chevronSVG}</div>
                </div>
            `;
      withdrawnAccordion.appendChild(withdrawnHeader);

      const withdrawnBody = document.createElement("div");
      withdrawnBody.className = "team-accordion-body";
      const withdrawnBodyInner = document.createElement("div");
      withdrawnBodyInner.className = "team-accordion-body-inner";

      for (const player of withdrawnPlayers) {
        withdrawnBodyInner.appendChild(
          await buildPlayerElement(player, isAdmin, client),
        );
      }
      withdrawnBody.appendChild(withdrawnBodyInner);
      withdrawnAccordion.appendChild(withdrawnBody);

      withdrawnHeader.addEventListener("click", () => {
        withdrawnAccordion.classList.toggle("accordion-open");
      });

      container.appendChild(withdrawnAccordion);
    }

    // Event listeners
    container.querySelectorAll(".btn-details").forEach((btn) => {
      btn.addEventListener("click", handleToggleDetails);
    });

    if (isAdmin) {
      container.querySelectorAll(".payment-icon").forEach((btn) => {
        btn.addEventListener("click", handlePaymentIconClick);
      });
      container.querySelectorAll(".receipt-icon").forEach((btn) => {
        btn.addEventListener("click", handleReceiptIconClick);
      });
      container.onclick = handlePlayerListAdminClick;
      container.querySelectorAll(".btn-whatsapp-player").forEach((btn) => {
        btn.addEventListener("click", handleWhatsAppPlayer);
      });
      container.querySelectorAll(".player-team-select").forEach((select) => {
        select.addEventListener("change", handlePlayerTeamChange);
      });
    }
  }

  async function buildPlayerElement(player, isAdmin, client) {
    const isWithdrawn = player.status === "withdrew";

    // Buscar telefone do jogador (apenas para admin)
    let playerPhone = null;
    if (isAdmin && client) {
      try {
        const { data: phone } = await client.rpc("get_player_phone", {
          p_username: player.username,
        });
        playerPhone = phone || null;
      } catch (e) {
        console.warn("Não foi possível buscar telefone de", player.username);
      }
    }

    const finalFee = Math.max(0, currentMatch.playerFee);
    const div = document.createElement("div");
    div.className = `player-item${isWithdrawn ? " player-withdrawn" : ""}`;

    // Badge de status
    let statusBadgeHTML = "";
    if (isWithdrawn) {
      statusBadgeHTML =
        '<span class="player-status-badge withdrew" title="Jogador desistiu">Desistiu</span>';
    }

    const paymentStatus = player.paid
      ? `<span class="payment-status paid" title="Pagamento confirmado"><span class="payment-status-text">Pago</span><span class="payment-status-symbol">✓</span></span>`
      : `<span class="payment-status unpaid" title="Pagamento pendente"><span class="payment-status-text">Pendente</span><span class="payment-status-symbol">✗</span></span>`;

    const detailsButton = isAdmin
      ? `<button class="btn-details" data-username="${player.username}" title="Ver detalhes"><span class="details-icon">👁️</span><span class="details-text">Ver detalhes</span></button>`
      : "";

    const whatsappButton =
      isAdmin && playerPhone
        ? `<div class="info-item"><button class="btn btn-whatsapp-player" data-phone="${playerPhone}" data-username="${player.username}" title="Enviar mensagem via WhatsApp">💬 Enviar WhatsApp</button></div>`
        : isAdmin
          ? `<div class="info-item"><span class="no-phone-info">📵 Sem celular cadastrado</span></div>`
          : "";

    const teamLabel = getPlayerTeamLabel(player);
    const playerTeam = getTeamById(player.teamId);
    const drawKey = getDrawKey(player.username);
    const hasDrawLocked = Boolean(
      player.teamId || player.teamName || currentMatch.teamDraws?.[drawKey],
    );
    const teamBadge =
      getMatchTeams().length > 0 && !isWithdrawn
        ? `<span class="player-team-badge ${teamLabel ? "" : "unassigned"}" style="${playerTeam ? `background: ${playerTeam.color}; color: #fff; border-color: ${playerTeam.color}; text-shadow: 0 1px 2px rgba(0,0,0,0.3);` : ""}"><span class="team-dot" style="background: #fff; opacity: 0.5;"></span>${teamLabel || "Sem time"}</span>`
        : "";
    const teamControl =
      isAdmin && getMatchTeams().length > 0 && !isWithdrawn
        ? `<div class="info-item team-control-item">
                <span class="info-label">Time:</span>
                <select class="player-team-select" data-username="${player.username}">
                    ${createTeamOptions(player.teamId || "")}
                </select>
            </div>`
        : !isWithdrawn && teamLabel
          ? `<div class="info-item"><span class="info-label">Time:</span><span class="info-value">${teamLabel}</span></div>`
          : "";

    // Info de desistência (visível nos detalhes)
    const withdrawInfo = isWithdrawn
      ? `
            <div class="info-item withdraw-info">
                <span class="info-label">📌 Status:</span>
                <span class="info-value withdrew">Desistiu da partida</span>
            </div>
            ${
              player.withdrawReason
                ? `<div class="info-item withdraw-info">
                <span class="info-label">💬 Motivo:</span>
                <span class="info-value">${player.withdrawReason}</span>
            </div>`
                : ""
            }
            ${
              player.withdrawnAt
                ? `<div class="info-item withdraw-info">
                <span class="info-label">🕐 Quando:</span>
                <span class="info-value">${new Date(player.withdrawnAt).toLocaleString("pt-BR")}</span>
            </div>`
                : ""
            }
        `
      : "";

    div.innerHTML = `
            <div class="player-info">
                <span class="player-name${isWithdrawn ? " withdrawn-name" : ""}">${player.username}</span>
                ${statusBadgeHTML}
                ${teamBadge}
                ${player.receiptSent ? '<span class="receipt-status">📄</span>' : ""}
            </div>
            <div class="player-item-right">
                <strong class="final-fee">${isWithdrawn ? "" : `R$ ${finalFee.toFixed(2).replace(".", ",")}`}</strong>
                ${isWithdrawn ? "" : paymentStatus}
                ${detailsButton}
            </div>
            <div class="player-details" id="details-${player.username}" style="display: none;">
                <div class="details-content">
                    <h4>Detalhes de ${player.username}</h4>
                    <div class="payment-info">
                        ${withdrawInfo}
                        <div class="info-item">
                            <span class="info-label">Status do Pagamento:</span>
                            <span class="info-value ${player.paid ? "paid" : "unpaid"}">
                                ${player.paid ? "✅ Pago" : "❌ Não Pago"}
                            </span>
                            ${isAdmin ? `<button class="admin-icon payment-icon" data-username="${player.username}" data-type="payment" title="Alterar status do pagamento">💰</button>` : ""}
                        </div>
                        <div class="info-item">
                            <span class="info-label">Comprovante:</span>
                            <span class="info-value ${player.receiptSent ? "sent" : "not-sent"}">
                                ${player.receiptSent ? "✅ Enviado" : "❌ Não Enviado"}
                            </span>
                            ${isAdmin ? `<button class="admin-icon receipt-icon" data-username="${player.username}" data-type="receipt" title="Alterar status do comprovante">📄</button>` : ""}
                        </div>
                        ${teamControl}
                        ${whatsappButton}
                        ${isAdmin && isScratchCardEnabled() && hasDrawLocked && !isWithdrawn ? `<div class="info-item"><button class="btn btn-secondary btn-release-draw" data-username="${player.username}" title="Liberar novo sorteio para este jogador">Liberar Novo Sorteio</button></div>` : ""}
                        ${isAdmin ? `<div class="info-item"><button class="btn btn-danger btn-remove-player" data-username="${player.username}" title="Remover jogador">🗑️ Remover Jogador</button></div>` : ""}
                    </div>
                </div>
            </div>`;
    return div;
  }

  function renderFinancialSummary() {
    const summaryContainer = document.getElementById("financial-summary");
    const activePlayers = currentMatch.players.filter(
      (p) => p.status !== "withdrew" && p.status !== "removed",
    );
    const totalPlayers = activePlayers.length;
    const paidPlayers = activePlayers.filter((p) => p.paid).length;
    const totalValue = totalPlayers * currentMatch.playerFee;
    const collectedValue = paidPlayers * currentMatch.playerFee;

    const percentPlayers =
      totalPlayers > 0 ? (paidPlayers / totalPlayers) * 100 : 0;
    const percentValue =
      totalValue > 0 ? (collectedValue / totalValue) * 100 : 0;

    summaryContainer.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 15px; margin-top: 15px;">
                <!-- Card Pagantes -->
                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 1.5rem;">👥</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Pagantes</span>
                    </div>
                    <div>
                        <div style="display: flex; align-items: baseline; gap: 5px;">
                            <span style="font-size: 1.8rem; font-weight: 800; color: var(--text-main);">${paidPlayers}</span>
                            <span style="font-size: 0.9rem; color: var(--text-muted); font-weight: 500;">/ ${totalPlayers}</span>
                        </div>
                    </div>
                    <div style="width: 100%; background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; overflow: hidden; margin-top: 5px;">
                        <div style="width: ${percentPlayers}%; height: 100%; background: var(--accent-blue); transition: width 0.5s ease;"></div>
                    </div>
                </div>

                <!-- Card Arrecadado -->
                <div style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 1.5rem;">💰</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Arrecadado</span>
                    </div>
                    <div>
                        <div style="display: flex; align-items: baseline; gap: 5px;">
                            <span style="font-size: 1.5rem; font-weight: 800; color: var(--accent-green);">R$ ${collectedValue.toFixed(2).replace(".", ",")}</span>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; font-weight: 500;">
                            de R$ ${totalValue.toFixed(2).replace(".", ",")}
                        </div>
                    </div>
                    <div style="width: 100%; background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; overflow: hidden; margin-top: 5px;">
                        <div style="width: ${percentValue}%; height: 100%; background: var(--accent-green); transition: width 0.5s ease;"></div>
                    </div>
                </div>
            </div>
        `;
  }

  function isDrawFull() {
    const teams = getMatchTeams();
    if (teams.length < 3) return false;

    const first3Teams = teams.slice(0, 3);
    const players = Array.isArray(currentMatch.players)
      ? currentMatch.players
      : [];

    let allFull = true;
    for (const team of first3Teams) {
      const count = players.filter(
        (p) => p.teamId === team.id || p.teamName === team.name,
      ).length;
      if (count < 7) {
        allFull = false;
        break;
      }
    }
    return allFull;
  }

  function createScratchCard() {
    const teams = getMatchTeams();
    const currentPlayer = getMatchPlayer(currentUser.username);
    const existingDraw = currentPlayer ? getCurrentUserDraw() : null;
    const selectedTeamName =
      existingDraw?.teamName || getTeamById(existingDraw?.teamId)?.name || "";
    const container = document.createElement("div");
    container.className = "scratch-card-container";

    const TOTAL_CARDS = 9;

    // Se já tem um time sorteado, mostra o resultado
    if (selectedTeamName) {
      container.innerHTML = `
                <div class="scratch-header">
                    <h3 class="scratch-title">Sorteio de Times</h3>
                    <p class="scratch-subtitle">Você já revelou seu time!</p>
                </div>
                <div class="scratch-cards-grid scratch-grid-result">
                    ${teams
                      .map((team) => {
                        const isChosen = team.name === selectedTeamName;
                        const color = getScratchColor(team.color);
                        return `
                            <div class="scratch-card ${isChosen ? "chosen revealed" : "revealed not-chosen"}" style="--card-color: ${color.hex}; --card-rgb: ${color.rgb};">
                                <div class="scratch-card-inner">
                                    <div class="scratch-card-content">
                                        <span class="scratch-team-dot" style="background: ${team.color};"></span>
                                        <span class="scratch-team-name">${team.name}</span>
                                        ${isChosen ? '<span class="scratch-chosen-label">SEU TIME!</span>' : ""}
                                    </div>
                                </div>
                            </div>
                        `;
                      })
                      .join("")}
                </div>
                <div class="scratch-result-banner">
                    <span>Seu time: <strong>${selectedTeamName}</strong></span>
                </div>
                <p class="scratch-auto-confirm">Você já está vinculado a este time.</p>
            `;
      // Adiciona botão "Ir para pagamento" para jogadores confirmados não pagos
      if (typeof getPlayerPaymentStatus === "function") {
        getPlayerPaymentStatus(currentUser.auth_id || currentUser.id)
          .then((status) => {
            if (
              status &&
              status.confirmed === true &&
              status.payment_status !== "paid"
            ) {
              const payBtn = document.createElement("button");
              payBtn.className = "btn btn-primary";
              payBtn.innerHTML = "💳 Ir para pagamento";
              payBtn.style.cssText =
                "margin-top: 12px; width: 100%; padding: 14px 20px; font-weight: 700; font-size: 0.95rem; border-radius: 12px; cursor: pointer; display: block; box-sizing: border-box; text-align: center;";
              payBtn.addEventListener(
                "click",
                () => (window.location.href = "payment.html"),
              );
              container.appendChild(payBtn);
            }
          })
          .catch(console.warn);
      }

      return container;
    }

    // Se o sorteio estiver cheio e houver o 4º time, permite entrada direta
    if (isDrawFull() && teams.length > 3) {
      const fourthTeam = teams[3];
      container.innerHTML = `
                <div class="scratch-header">
                    <h3 class="scratch-title">Sorteio Encerrado</h3>
                    <p class="scratch-subtitle">Os 3 primeiros times já estão completos (7 jogadores cada).<br>As novas vagas são para o <strong>${fourthTeam.name}</strong>.</p>
                </div>
                <div style="text-align: center; margin: 25px 0;">
                    <button class="btn btn-primary" id="btn-join-fourth-team" style="background: ${fourthTeam.color}; border-color: ${fourthTeam.color}; width: 100%; font-size: 1.1rem; padding: 14px;">
                        Entrar no ${fourthTeam.name}
                    </button>
                </div>
            `;
      setTimeout(() => {
        const btn = container.querySelector("#btn-join-fourth-team");
        if (btn) {
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.innerHTML =
              '<span class="scratch-spinner" style="display:inline-block; border-color:#fff; border-bottom-color:transparent; width:16px; height:16px; margin-right:8px;"></span> Entrando...';
            try {
              const result = await playerDrawTeam(
                currentMatch.id,
                fourthTeam.id,
              );
              if (result && result.assignment) {
                FMModal.success(
                  "Você entrou no " + result.assignment.teamName + "!",
                );
                setTimeout(() => window.location.reload(), 1500);
              }
            } catch (err) {
              btn.disabled = false;
              btn.innerHTML = "Entrar no " + fourthTeam.name;
              FMModal.error(err.message || "Erro ao entrar no time.");
            }
          });
        }
      }, 0);
      return container;
    }

    // Se não estiver cheio, sorteia apenas entre os 3 primeiros
    const drawTeams = teams.slice(0, 3);

    // Monta array de 9 slots: times reais + neutros
    const teamSlots = drawTeams.map((team) => ({
      type: "team",
      team: team,
      color: getScratchColor(team.color),
    }));

    const neutralCount = Math.max(0, TOTAL_CARDS - drawTeams.length);
    const neutralMessages = [
      "Tente outro!",
      "Quase lá...",
      "Não foi dessa vez!",
      "Continue tentando!",
      "Tente de novo!",
      "Próxima será!",
    ];

    // Cores para cartões neutros (usa índices que não conflitam com os times)
    const usedColorValues = teamSlots.map((s) => s.color.hex);
    let neutralColorIdx = 0;
    const neutralSlots = [];
    for (let i = 0; i < neutralCount; i++) {
      const neutralColor = getScratchColor(neutralColorIdx);
      if (usedColorValues.includes(neutralColor.hex)) {
        neutralColorIdx++;
      }
      neutralSlots.push({
        type: "neutral",
        team: null,
        color: getScratchColor(neutralColorIdx),
        message: neutralMessages[i % neutralMessages.length],
      });
      neutralColorIdx++;
    }

    // Combina e embaralha tudo aleatoriamente
    const allSlots = [...teamSlots, ...neutralSlots].sort(
      () => Math.random() - 0.5,
    );

    container.innerHTML = `
            <div class="scratch-header">
                <h3 class="scratch-title">Sorteio de Times</h3>
                <p class="scratch-subtitle">Encontre seu time entre os <strong>9 cartões</strong>!</p>
            </div>
            <div class="scratch-cards-grid scratch-grid-9">
                ${allSlots
                  .map((slot, index) => {
                    const color = slot.color;
                    const isTeam = slot.type === "team";
                    const teamId = isTeam ? slot.team.id : "";
                    const teamName = isTeam ? slot.team.name : "";
                    const neutralMsg = !isTeam ? slot.message : "";
                    return `
                    <div class="scratch-card covered"
                         data-type="${slot.type}"
                         data-team-id="${teamId}"
                         data-team-name="${teamName}"
                         data-neutral-msg="${neutralMsg}"
                         data-index="${index}"
                         style="--card-color: ${color.hex}; --card-rgb: ${color.rgb};">
                        <div class="scratch-card-inner">
                            <div class="scratch-card-cover">
                                <div class="scratch-shimmer"></div>
                                <span class="scratch-question">?</span>
                                <span class="scratch-hint">Raspe aqui</span>
                            </div>
                            <div class="scratch-card-content">
                                ${
                                  isTeam
                                    ? `<span class="scratch-team-dot" style="background: ${slot.team.color};"></span><span class="scratch-team-name">${teamName}</span>`
                                    : `<span class="scratch-neutral-icon">✕</span>
                                       <span class="scratch-neutral-msg">${neutralMsg}</span>`
                                }
                            </div>
                        </div>
                    </div>
                    `;
                  })
                  .join("")}
            </div>
            <div class="scratch-footer-hint">
                ${drawTeams.length} time${drawTeams.length > 1 ? "s" : ""} escondido${drawTeams.length > 1 ? "s" : ""} entre 9 cartões — boa sorte!
            </div>
        `;

    // Adiciona interatividade
    scratchCardState = { hasChosen: false, chosenIndex: -1 };
    container.querySelectorAll(".scratch-card.covered").forEach((card) => {
      card.addEventListener("click", handleScratchReveal);
      card.addEventListener("mouseenter", () => {
        if (!scratchCardState.hasChosen) {
          card.classList.add("scratching");
        }
      });
      card.addEventListener("mouseleave", () => {
        card.classList.remove("scratching");
      });
    });

    return container;
  }

  async function handleScratchReveal(event) {
    // Se já encontrou um time, bloqueia TOTALMENTE
    if (scratchCardState.hasChosen) return;

    // Bloqueia IMEDIATAMENTE para evitar múltiplos cliques
    scratchCardState.hasChosen = true;

    const card = event.currentTarget;
    const cardType = card.dataset.type;
    const container = card.closest(".scratch-card-container");

    // Remove evento do cartão clicado
    card.removeEventListener("click", handleScratchReveal);

    // Desabilita TODOS os cartões instantaneamente (anti-spam)
    container.querySelectorAll(".scratch-card.covered").forEach((c) => {
      c.removeEventListener("click", handleScratchReveal);
      c.style.pointerEvents = "none";
    });

    const content = card.querySelector(".scratch-card-content");
    const originalContent = content.innerHTML;

    // PREVENÇÃO DE FLICKER: Injeta loading e remove cores falsas IMEDIATAMENTE
    // antes mesmo de a camada protetora (scratch-card-cover) ser removida.
    if (cardType === "team") {
      content.innerHTML =
        '<div class="scratch-loading"><span class="scratch-spinner"></span><span>Sorteando...</span></div>';
      card.style.setProperty("--card-color", "#334155");
      card.style.setProperty("--card-rgb", "51, 65, 85");
      card.classList.add("chosen");
    }

    // Animação de revelação
    card.classList.remove("covered", "scratching");
    card.classList.add("revealing");
    await new Promise((resolve) => setTimeout(resolve, 700));
    card.classList.remove("revealing");

    if (cardType === "neutral") {
      // Cartão neutro — revela como vazio e permite tentar novamente
      card.classList.add("revealed", "neutral-revealed");

      // REATIVA a interação para os cartões restantes
      scratchCardState.hasChosen = false;
      container.querySelectorAll(".scratch-card.covered").forEach((c) => {
        c.style.pointerEvents = "auto";
        c.addEventListener("click", handleScratchReveal);
      });

      const footerHint = container.querySelector(".scratch-footer-hint");
      if (footerHint) {
        const remainingCovered = container.querySelectorAll(
          ".scratch-card.covered",
        ).length;
        footerHint.innerHTML = `Não foi dessa vez! Restam <strong>${remainingCovered}</strong> cartões — tente novamente!`;
      }
      return;
    }

    // ================================================================
    // CARTÃO COM TIME ENCONTRADO - SORTEIO NO BACKEND
    // ================================================================
    card.classList.add("revealed");

    let assignedTeamName = card.dataset.teamName; // fallback visual
    let drawSuccess = false;

    try {
      // Chama a RPC SEGURA no backend (NUNCA faz sorteio no frontend)
      const result = await playerDrawTeam(currentMatch.id);

      if (result && result.assignment) {
        assignedTeamName = result.assignment.teamName || assignedTeamName;
        drawSuccess = true;
        console.log("✅ Sorteio confirmado no servidor:", assignedTeamName);
        if (typeof updatePlayerPaymentStatus === "function") {
          updatePlayerPaymentStatus(currentUser.auth_id || currentUser.id, {
            confirmed: true,
          }).catch(console.warn);
        }
      }
    } catch (error) {
      console.error("❌ Erro no sorteio:", error);

      // Verifica se o erro é "already_joined" (já tem time)
      if (
        error.message &&
        (error.message.includes("already") ||
          error.message.includes("possui") ||
          error.message.includes("sorteado"))
      ) {
        // Já tem time - tenta recuperar do servidor
        try {
          const status = await getPlayerDrawStatus(currentMatch.id);
          if (status && status.has_draw) {
            assignedTeamName = status.team_name;
            drawSuccess = true;
            console.log("✅ Time recuperado do servidor:", assignedTeamName);
            if (typeof updatePlayerPaymentStatus === "function") {
              updatePlayerPaymentStatus(currentUser.auth_id || currentUser.id, {
                confirmed: true,
              }).catch(console.warn);
            }
          }
        } catch (statusError) {
          console.warn("Não foi possível recuperar status:", statusError);
        }
      }

      if (!drawSuccess) {
        // Erro real - reverte o estado
        content.innerHTML = originalContent;
        card.classList.remove("revealed", "chosen");
        card.classList.add("covered");
        scratchCardState.hasChosen = false;

        // Reativa cartões
        container.querySelectorAll(".scratch-card.covered").forEach((c) => {
          c.style.pointerEvents = "auto";
          c.addEventListener("click", handleScratchReveal);
        });

        FMModal.error(
          error.message || "Erro ao realizar o sorteio. Tente novamente.",
        );
        return;
      }
    }

    // ================================================================
    // ATUALIZAÇÃO VISUAL: Garantir cor, nome e consistência exata do time real
    // ================================================================

    // 1. Encontra os dados reais do time sorteado
    const teams = getMatchTeams();
    const realTeam = teams.find((t) => t.name === assignedTeamName) || {
      name: assignedTeamName,
      color: "#10b981",
    };
    const realColor = getScratchColor(realTeam.color);

    // 2. Resolve o conflito de duplicidade de nomes (Swap Visual)
    // Se este cartão foi gerado inicialmente com o Time A, mas o backend sorteou o Time B...
    // Trocamos a identidade (dataset e cor visual) do cartão que tinha o Time B para ser o Time A.
    const originalCardTeamName = card.dataset.teamName;
    if (originalCardTeamName && originalCardTeamName !== assignedTeamName) {
      const otherCardWithRealTeam = Array.from(
        container.querySelectorAll(".scratch-card"),
      ).find(
        (c) =>
          c !== card &&
          c.dataset.teamName === assignedTeamName &&
          c.dataset.type === "team",
      );

      if (otherCardWithRealTeam) {
        const originalColorStr = card.style.getPropertyValue("--card-color");
        const originalRgbStr = card.style.getPropertyValue("--card-rgb");
        const originalTeamId = card.dataset.teamId;
        const originalTeamObj = teams.find(
          (t) => t.name === originalCardTeamName,
        ) || { color: "#10b981" };

        otherCardWithRealTeam.dataset.teamName = originalCardTeamName;
        otherCardWithRealTeam.dataset.teamId = originalTeamId || "";
        otherCardWithRealTeam.style.setProperty(
          "--card-color",
          originalColorStr,
        );
        otherCardWithRealTeam.style.setProperty("--card-rgb", originalRgbStr);

        const otherContent = otherCardWithRealTeam.querySelector(
          ".scratch-card-content",
        );
        if (otherContent) {
          otherContent.innerHTML = `<span class="scratch-team-dot" style="background: ${originalTeamObj.color};"></span><span class="scratch-team-name">${originalCardTeamName}</span>`;
        }
      }
    }

    // 3. Aplica a cor, o nome e a estilização real do time sorteado no cartão clicado
    card.dataset.teamName = assignedTeamName;
    if (realTeam.id) card.dataset.teamId = realTeam.id;
    card.style.setProperty("--card-color", realColor.hex);
    card.style.setProperty("--card-rgb", realColor.rgb);

    content.innerHTML = `
            <span class="scratch-team-dot" style="background: ${realTeam.color};"></span>
            <span class="scratch-team-name">${assignedTeamName}</span>
            <span class="scratch-chosen-label">SEU TIME!</span>
        `;

    // Revela todos os cartões restantes em cascata
    const allCards = container.querySelectorAll(".scratch-card");
    let delay = 250;
    for (const otherCard of allCards) {
      if (otherCard === card || otherCard.classList.contains("revealed"))
        continue;
      await new Promise((resolve) => setTimeout(resolve, delay));
      otherCard.removeEventListener("click", handleScratchReveal);
      otherCard.classList.remove("covered", "scratching");
      otherCard.classList.add("revealing");
      await new Promise((resolve) => setTimeout(resolve, 400));
      otherCard.classList.remove("revealing");
      const isNeutral = otherCard.dataset.type === "neutral";
      otherCard.classList.add(
        "revealed",
        isNeutral ? "neutral-revealed" : "not-chosen",
      );
      delay = Math.max(100, delay - 30);
    }

    // Mostra o resultado final
    const footerHint = container.querySelector(".scratch-footer-hint");
    if (footerHint) {
      footerHint.innerHTML = `
                <div class="scratch-result-banner animated">
                    <span>Seu time: <strong>${assignedTeamName}</strong></span>
                </div>
            `;
    }

    // Mensagem de confirmação automática
    const autoMsg = document.createElement("p");
    autoMsg.className = "scratch-auto-confirm";
    autoMsg.innerHTML = "✅ Sorteio salvo com segurança! Atualizando...";
    container.appendChild(autoMsg);

    // Botão de compartilhamento WhatsApp
    const shareBtn = document.createElement("button");
    shareBtn.className = "btn btn-whatsapp-share";
    shareBtn.innerHTML =
      "\ud83d\udce9 Enviar lista de jogadores atualizada para administrador";
    shareBtn.style.cssText =
      "margin-top: 12px; width: 100%; background: linear-gradient(135deg, #25d366, #128c7e); border: none; color: white; padding: 14px 20px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.2s, filter 0.2s;";
    shareBtn.addEventListener("mouseenter", () => {
      shareBtn.style.transform = "translateY(-2px)";
      shareBtn.style.filter = "brightness(1.1)";
    });
    shareBtn.addEventListener("mouseleave", () => {
      shareBtn.style.transform = "none";
      shareBtn.style.filter = "none";
    });
    shareBtn.addEventListener("click", () => handleShareTeamList());
    container.appendChild(shareBtn);

    // Adiciona botão "Ir para pagamento" para jogadores confirmados não pagos
    if (typeof getPlayerPaymentStatus === "function") {
      getPlayerPaymentStatus(currentUser.auth_id || currentUser.id)
        .then((status) => {
          if (
            status &&
            status.confirmed === true &&
            status.payment_status !== "paid"
          ) {
            const payBtn = document.createElement("button");
            payBtn.className = "btn btn-primary";
            payBtn.innerHTML = "💳 Ir para pagamento";
            payBtn.style.cssText =
              "margin-top: 12px; width: 100%; padding: 14px 20px; font-weight: 700; font-size: 0.95rem; border-radius: 12px; cursor: pointer;";
            payBtn.addEventListener(
              "click",
              () => (window.location.href = "payment.html"),
            );
            container.appendChild(payBtn);
          }
        })
        .catch(console.warn);
    }

    // Recarrega a página para sincronizar com o servidor
    setTimeout(() => loadAndRenderPage(), 2500);
  }

  function renderActionButtons() {
    actionButtonsContainer.innerHTML = "";

    const currentPlayer = getMatchPlayer(currentUser.username);
    const isPlayerInMatch = Boolean(currentPlayer);
    const isWithdrawn = currentPlayer?.status === "withdrew";
    const isVisitor = currentUser.role === "visitor";

    // Visitante vê mensagem informativa
    if (isVisitor) {
      const visitorMsg = document.createElement("div");
      visitorMsg.className = "withdrawn-notice";
      visitorMsg.style.cssText =
        "border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.06);";
      visitorMsg.innerHTML = `
                <div class="withdrawn-notice-icon">👁️</div>
                <div class="withdrawn-notice-content">
                    <strong>Você está como visitante</strong>
                    <p>Visitantes podem acompanhar a partida, mas não participar. <a href="../pages/register.html" style="color: var(--accent-blue); font-weight: 700;">Cadastre-se</a> para jogar!</p>
                </div>
            `;
      actionButtonsContainer.appendChild(visitorMsg);
      return;
    }

    // Jogador que desistiu vê uma mensagem informativa
    if (isWithdrawn) {
      const withdrawnMsg = document.createElement("div");
      withdrawnMsg.className = "withdrawn-notice";
      withdrawnMsg.innerHTML = `
                <div class="withdrawn-notice-icon">⚠️</div>
                <div class="withdrawn-notice-content">
                    <strong>Você desistiu desta partida</strong>
                    <p>Seu status foi registrado como desistente. Caso queira retornar, entre em contato com o administrador.</p>
                    ${currentPlayer.withdrawReason ? `<p class="withdrawn-reason"><em>Motivo: ${currentPlayer.withdrawReason}</em></p>` : ""}
                </div>
            `;
      actionButtonsContainer.appendChild(withdrawnMsg);
      return;
    }

    if (playerCanDrawAgain(currentPlayer)) {
      actionButtonsContainer.appendChild(createScratchCard());
      actionButtonsContainer.appendChild(
        createActionButton(
          "Não Poderei Comparecer",
          "btn-danger",
          handleLeaveMatch,
        ),
      );
      return;
    }
    if (isPlayerInMatch) {
      // Se o jogador já tem time, mostra o botão de compartilhamento
      const playerHasTeam = currentPlayer.teamName || currentPlayer.teamId;
      if (playerHasTeam && isScratchCardEnabled()) {
        const shareContainer = document.createElement("div");
        shareContainer.style.cssText = "width: 100%; margin-bottom: 12px;";
        shareContainer.innerHTML = `
                    <button type="button" class="btn btn-whatsapp-share" id="btn-share-teams" style="
                        width: 100%; background: linear-gradient(135deg, #25d366, #128c7e); border: none; color: white;
                        padding: 14px 20px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer;
                        display: flex; align-items: center; justify-content: center; gap: 8px;
                        transition: transform 0.2s, filter 0.2s; box-shadow: 0 6px 20px rgba(37,211,102,0.3);
                    ">
                        \ud83d\udce9 Enviar lista de jogadores atualizada para administrador
                    </button>
                `;
        actionButtonsContainer.appendChild(shareContainer);
        const shareButton = shareContainer.querySelector("#btn-share-teams");
        shareButton.addEventListener("mouseenter", () => {
          shareButton.style.transform = "translateY(-2px)";
          shareButton.style.filter = "brightness(1.1)";
        });
        shareButton.addEventListener("mouseleave", () => {
          shareButton.style.transform = "none";
          shareButton.style.filter = "none";
        });
        shareButton.addEventListener("click", handleShareTeamList);
      }

      // EXIBIR BOTÃO DE PAGAMENTO para quem tem time (está no sorteio) e não pagou
      if (playerHasTeam && !currentPlayer.paid) {
        const payBtn = document.createElement("button");
        payBtn.className = "btn btn-primary btn-pay-now";
        payBtn.innerHTML = "💳 Ir para pagamento";
        payBtn.style.cssText =
          "margin-bottom: 12px; width: 100%; padding: 14px 20px; font-weight: 700; font-size: 0.95rem; border-radius: 12px; cursor: pointer; display: block; text-align: center;";
        payBtn.addEventListener(
          "click",
          () => (window.location.href = "payment.html"),
        );
        actionButtonsContainer.appendChild(payBtn);
      }

      actionButtonsContainer.appendChild(
        createActionButton(
          "Não Poderei Comparecer",
          "btn-danger",
          handleLeaveMatch,
        ),
      );
    } else if (isScratchCardEnabled()) {
      actionButtonsContainer.appendChild(createScratchCard());
    } else {
      actionButtonsContainer.appendChild(
        createActionButton("Quero Participar", "btn-primary", handleJoinMatch),
      );
    }
  }

  function renderAdminControls() {
    if (currentUser.role !== "admin") {
      adminControlsSection.style.display = "none";
      return;
    }
    adminControlsSection.style.display = "block";
    const container = adminControlsSection.querySelector(
      ".admin-buttons-container",
    );
    container.innerHTML = "";

    const playerManager = document.createElement("div");
    playerManager.className = "admin-player-management";
    const teamSelectHTML =
      getMatchTeams().length > 0
        ? `
            <select id="new-player-team" class="admin-input">
                ${createTeamOptions("")}
            </select>
        `
        : "";
    playerManager.innerHTML = `
            <h4>Gerenciar Jogadores</h4>
            <div class="add-player-section">
                <input type="text" id="new-player-name" class="admin-input" placeholder="Nome do jogador">
                ${teamSelectHTML}
                <button type="button" class="btn btn-primary" id="add-player-btn">Adicionar Jogador</button>
            </div>
        `;
    container.appendChild(playerManager);
    playerManager
      .querySelector("#add-player-btn")
      .addEventListener("click", handleAdminAddPlayer);

    const teamManager = document.createElement("div");
    teamManager.className = "admin-team-management";
    const teams = getMatchTeams();
    teamManager.innerHTML = `
            <h4>Times da Partida</h4>
            <div class="admin-team-list">
                ${teams.length > 0 ? teams.map((team) => `<span class="admin-team-pill">${team.name}</span>`).join("") : '<span class="admin-empty-text">Nenhum time cadastrado.</span>'}
            </div>
            <button type="button" class="btn btn-secondary" id="edit-teams-btn">Editar Times</button>
        `;
    container.appendChild(teamManager);
    teamManager
      .querySelector("#edit-teams-btn")
      .addEventListener("click", () => {
        sessionStorage.setItem("editMatchId", currentMatch.id);
        window.location.href = "schedule.html";
      });

    // Controles de status da partida
    if (
      currentMatch.status === "ENCERRADA" &&
      !currentMatch.results_processed
    ) {
      container.appendChild(
        createAdminButton("Apurar Votos e Finalizar", "btn-confirm", () =>
          processVotingResults(currentMatch),
        ),
      );
    }
    if (
      currentMatch.status !== "CONFIRMADA" &&
      currentMatch.status !== "ENCERRADA"
    ) {
      container.appendChild(
        createAdminButton("Confirmar Partida", "btn-confirm", () =>
          updateMatchStatus("CONFIRMADA"),
        ),
      );
    }
    if (
      currentMatch.status !== "CANCELADA" &&
      currentMatch.status !== "ENCERRADA"
    ) {
      container.appendChild(
        createAdminButton("Cancelar Partida", "btn-cancel", () =>
          updateMatchStatus("CANCELADA"),
        ),
      );
    }
    if (currentMatch.status !== "ENCERRADA") {
      container.appendChild(
        createAdminButton("Encerrar Partida", "btn-secondary", () =>
          updateMatchStatus("ENCERRADA"),
        ),
      );
    }
    if (
      ["CONFIRMADA", "CANCELADA", "ENCERRADA"].includes(currentMatch.status)
    ) {
      container.appendChild(
        createAdminButton("Reagendar", "btn-reschedule", () =>
          updateMatchStatus("AGENDADA"),
        ),
      );
    }
  }

  function renderVotingSection() {
    const bestPlayerVotesContainer =
      document.getElementById("best-player-votes");
    const worstPlayerVotesContainer =
      document.getElementById("worst-player-votes");
    const voteMessage = document.getElementById("vote-message");
    if (countdownInterval) clearInterval(countdownInterval);
    if (currentMatch.status !== "ENCERRADA") {
      votingSection.style.display = "none";
      return;
    }
    votingSection.style.display = "block";

    // Verificar se é visitante
    const isVisitor = currentUser.role === "visitor";

    if (currentMatch.results_processed) {
      voteMessage.innerHTML =
        "<span style='color:var(--accent-green);font-weight:600'>Votação encerrada e resultados apurados.</span>";

      const findWinner = (votes) => {
        if (!votes || votes.length === 0) return null;
        const voteCounts = votes.reduce((acc, vote) => {
          acc[vote.candidate] = (acc[vote.candidate] || 0) + 1;
          return acc;
        }, {});
        const sortedVotes = Object.entries(voteCounts).sort(
          (a, b) => b[1] - a[1],
        );
        return sortedVotes.length > 0
          ? { name: sortedVotes[0][0], count: sortedVotes[0][1] }
          : null;
      };

      const bestWinner = findWinner(currentMatch.votes?.best_player || []);
      const worstWinner = findWinner(currentMatch.votes?.worst_player || []);

      bestPlayerVotesContainer.innerHTML = bestWinner
        ? `<div class="vote-winner best-winner">
                     <div class="winner-icon">⭐</div>
                     <div class="winner-info">
                         <div class="winner-name">${bestWinner.name}</div>
                         <div class="winner-count">${bestWinner.count} voto(s)</div>
                     </div>
                   </div>`
        : '<p class="no-votes">Nenhum voto registrado.</p>';

      worstPlayerVotesContainer.innerHTML = worstWinner
        ? `<div class="vote-winner worst-winner">
                     <div class="winner-icon">🪵</div>
                     <div class="winner-info">
                         <div class="winner-name">${worstWinner.name}</div>
                         <div class="winner-count">${worstWinner.count} voto(s)</div>
                     </div>
                   </div>`
        : '<p class="no-votes">Nenhum voto registrado.</p>';

      return;
    }

    // Mostrar mensagem para visitantes
    if (isVisitor) {
      voteMessage.innerHTML = `<span style="color: #fbbf24; font-weight: 600;">\ud83d\udc41\ufe0f Visitantes n\u00e3o podem votar. <a href=\"../pages/register.html\" style=\"color: var(--accent-blue);\">Cadastre-se</a> para participar!</span>`;
      bestPlayerVotesContainer.innerHTML =
        '<p class="no-votes" style="color: var(--text-muted);">Fa\u00e7a login como jogador para votar.</p>';
      worstPlayerVotesContainer.innerHTML =
        '<p class="no-votes" style="color: var(--text-muted);">Fa\u00e7a login como jogador para votar.</p>';
      return;
    }

    const deadline = new Date(currentMatch.voting_deadline);
    countdownInterval = setInterval(() => {
      const now = new Date().getTime();
      const distance = deadline - now;
      if (distance < 0) {
        clearInterval(countdownInterval);
        voteMessage.innerHTML =
          "Tempo esgotado! Recarregue a página para apurar os resultados.";
        return;
      }
      const hours = Math.floor(
        (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);
      voteMessage.innerHTML = `Tempo restante para votar: <br><strong>${hours}h ${minutes}m ${seconds}s</strong>`;
    }, 1000);
    bestPlayerVotesContainer.innerHTML = "";
    worstPlayerVotesContainer.innerHTML = "";
    const userHasVotedBest = currentMatch.votes.best_player.some(
      (v) => v.voter === currentUser.username,
    );
    const userHasVotedWorst = currentMatch.votes.worst_player.some(
      (v) => v.voter === currentUser.username,
    );

    // Progresso de votação
    const totalVoters = currentMatch.players.filter(
      (p) => p.status !== "withdrew" && p.status !== "removed",
    ).length;
    const uniqueBestVoters = new Set(
      currentMatch.votes.best_player.map((v) => v.voter),
    ).size;
    const uniqueWorstVoters = new Set(
      currentMatch.votes.worst_player.map((v) => v.voter),
    ).size;

    // Status cards acima das listas de votacao
    const statusBestHtml = `<div class="vote-progress-bar">
            <div class="vote-progress-fill" style="width: ${totalVoters > 0 ? (uniqueBestVoters / totalVoters) * 100 : 0}%;"></div>
            <span class="vote-progress-text">${uniqueBestVoters}/${totalVoters} votaram</span>
        </div>`;
    const statusWorstHtml = `<div class="vote-progress-bar">
            <div class="vote-progress-fill worst" style="width: ${totalVoters > 0 ? (uniqueWorstVoters / totalVoters) * 100 : 0}%;"></div>
            <span class="vote-progress-text">${uniqueWorstVoters}/${totalVoters} votaram</span>
        </div>`;

    bestPlayerVotesContainer.innerHTML =
      statusBestHtml +
      (userHasVotedBest
        ? '<div class="vote-confirmed-badge">✅ Seu voto foi registrado</div>'
        : "");
    worstPlayerVotesContainer.innerHTML =
      statusWorstHtml +
      (userHasVotedWorst
        ? '<div class="vote-confirmed-badge">✅ Seu voto foi registrado</div>'
        : "");

    // Lista de candidatos (excluindo o próprio jogador)
    const activePlayers = currentMatch.players.filter(
      (p) => p.status !== "withdrew" && p.status !== "removed",
    );
    activePlayers.forEach((player) => {
      const votesForPlayerBest = currentMatch.votes.best_player.filter(
        (v) => v.candidate === player.username,
      ).length;
      bestPlayerVotesContainer.appendChild(
        createCandidateElement(
          player,
          votesForPlayerBest,
          "best_player",
          userHasVotedBest,
        ),
      );
      const votesForPlayerWorst = currentMatch.votes.worst_player.filter(
        (v) => v.candidate === player.username,
      ).length;
      worstPlayerVotesContainer.appendChild(
        createCandidateElement(
          player,
          votesForPlayerWorst,
          "worst_player",
          userHasVotedWorst,
        ),
      );
    });
  }

  function renderFinancialsButton() {
    const container = document.getElementById("financial-btn-container");
    if (!container) return; // Segurança
    container.innerHTML = ""; // Limpa botões antigos se houver
    const financialBtn = createActionButton(
      "📊 Ver Resumo Financeiro",
      "btn-primary",
      () => {
        window.location.href = "financials.html";
      },
    );
    container.appendChild(financialBtn);
  }

  // handleDrawTeam removido — substituído pelo sistema de raspadinha (handleScratchReveal + handleScratchConfirm)

  async function handleJoinMatch() {
    if (!currentUser) return;

    if (!currentUser.username) {
      await FMModal.warning(
        "Seu cadastro parece estar incompleto ou a sessao expirou. Por favor, faca login novamente.",
      );
      window.location.href = "../index.html";
      return;
    }

    if (isScratchCardEnabled()) {
      if (typeof isDrawFull === "function" && isDrawFull()) {
        FMModal.drawConfirm(
          "As vagas para o sorteio acabaram! Role a tela para baixo e entre diretamente no 4º time.",
        );
      } else {
        FMModal.drawConfirm(
          "Esta partida possui sorteio de times. Use o sorteio para participar.",
        );
      }
      renderActionButtons();
      return;
    }

    console.log(
      "🎯 Iniciando processo de participação na partida diretamente...",
    );

    // Verificar se o jogador já está na partida
    const isPlayerInMatch = currentMatch.players.some(
      (p) => getDrawKey(p.username) === getDrawKey(currentUser.username),
    );
    if (isPlayerInMatch) {
      FMModal.info("Voce ja esta participando desta partida.");
      return;
    }

    const btn = document.querySelector(".action-buttons .btn-primary");
    if (btn) {
      btn.innerHTML = "⏳ Confirmando...";
      btn.disabled = true;
    }

    try {
      const newPlayer = {
        username: currentUser.username,
        paid: false,
        receiptSent: false,
      };

      // Adicionar ao array de jogadores local
      currentMatch.players.push(newPlayer);

      // Atualizar no banco de dados
      await playerUpdateMatchData(
        currentMatch.id,
        currentMatch.players,
        currentMatch.votes,
      );

      loadAndRenderPage(); // Re-renderiza a página
      FMModal.success("Presenca confirmada com sucesso!");
    } catch (error) {
      console.error("❌ Erro ao entrar na partida:", error);
      FMModal.error("Erro ao confirmar presenca. Tente novamente.");
      if (btn) {
        btn.innerHTML = "Quero Participar";
        btn.disabled = false;
      }
    }
  }

  async function handleLeaveMatch() {
    const response = await FMModal.promptTextarea({
      type: "admin",
      title: "Motivo da Desistencia",
      message: "Informe ao administrador o motivo da sua saida.",
      label: "Motivo",
      name: "reason",
      rows: 4,
      confirmLabel: "Confirmar Desistencia",
      cancelLabel: "Cancelar",
      danger: true,
      requiredMessage: "Informe o motivo para continuar.",
      priority: 80,
    });

    if (!response.confirmed) return;
    await confirmLeaveMatch(response.value);
  }

  // Função para alternar a exibição dos detalhes do jogador
  function handleToggleDetails(event) {
    const button = event.currentTarget;
    const username = button.dataset.username;
    const detailsDiv = document.getElementById(`details-${username}`);
    const icon = button.querySelector(".details-icon");
    const text = button.querySelector(".details-text");

    if (detailsDiv.style.display === "none") {
      detailsDiv.style.display = "block";
      if (icon) icon.textContent = "🙈";
      if (text) text.textContent = "Ocultar";
      button.title = "Ocultar detalhes";
    } else {
      detailsDiv.style.display = "none";
      if (icon) icon.textContent = "👁️";
      if (text) text.textContent = "Ver detalhes";
      button.title = "Ver detalhes";
    }
  }

  // Função para lidar com clique no ícone de pagamento
  async function handlePaymentIconClick(event) {
    const username = event.currentTarget.dataset.username;
    const player = currentMatch.players.find((p) => p.username === username);

    if (!player) return;

    // Alternar status do pagamento
    player.paid = !player.paid;

    try {
      await addMatch(currentMatch);
      if (player.paid) {
        await clearPlayerStats(player.username);
      }

      // Sincroniza status global no Supabase
      if (typeof updatePlayerPaymentStatusByUsername === "function") {
        await updatePlayerPaymentStatusByUsername(player.username, {
          payment_status: player.paid ? "paid" : "pending",
        });
      }

      loadAndRenderPage();
    } catch (error) {
      console.error("Erro ao atualizar pagamento:", error);
      FMModal.error("Erro ao atualizar pagamento. Tente novamente.");
      // Reverter mudança em caso de erro
      player.paid = !player.paid;
    }
  }

  // Função para lidar com clique no ícone de comprovante
  async function handleReceiptIconClick(event) {
    const username = event.currentTarget.dataset.username;
    const player = currentMatch.players.find((p) => p.username === username);

    if (!player) return;

    // Alternar status do comprovante
    player.receiptSent = !player.receiptSent;

    try {
      await addMatch(currentMatch);
      loadAndRenderPage();
    } catch (error) {
      console.error("Erro ao atualizar comprovante:", error);
      FMModal.error("Erro ao atualizar comprovante. Tente novamente.");
      // Reverter mudança em caso de erro
      player.receiptSent = !player.receiptSent;
    }
  }

  async function handleAdminAddPlayer() {
    const playerNameInput = document.getElementById("new-player-name");
    const playerTeamSelect = document.getElementById("new-player-team");
    const playerName = playerNameInput.value.trim();

    if (!playerName) {
      FMModal.warning("Por favor, digite o nome do jogador.");
      return;
    }

    const playerExists = currentMatch.players.some(
      (p) => p.username.toLowerCase() === playerName.toLowerCase(),
    );
    if (playerExists) {
      FMModal.warning("Este jogador ja esta na partida.");
      return;
    }

    const selectedTeam = playerTeamSelect?.value
      ? getTeamById(playerTeamSelect.value)
      : null;

    currentMatch.players.push({
      username: playerName,
      paid: false,
      receiptSent: false,
      ...(selectedTeam
        ? {
            teamId: selectedTeam.id,
            teamName: selectedTeam.name,
            assignmentMode: "manual",
          }
        : {}),
    });

    try {
      await addMatch(currentMatch);
      playerNameInput.value = "";
      if (playerTeamSelect) playerTeamSelect.value = "";
      FMModal.success(`Jogador "${playerName}" adicionado com sucesso!`);
      loadAndRenderPage();
    } catch (error) {
      currentMatch.players = currentMatch.players.filter(
        (p) => p.username !== playerName,
      );
      console.error("Erro ao adicionar jogador:", error);
      FMModal.error(
        error?.message || "Erro ao adicionar jogador. Tente novamente.",
      );
    }
  }

  async function handleRemovePlayer(event) {
    const username = event.currentTarget.dataset.username;
    const usernameKey = normalizeTeamKey(username);

    const removeConfirmed = await FMModal.confirm({
      type: "admin",
      title: "Remover jogador",
      message: `Tem certeza que deseja remover "${username}" da partida?`,
      confirmLabel: "Remover",
      danger: true,
      priority: 80,
    });
    if (!removeConfirmed) return;

    const previousPlayers = [...currentMatch.players];
    const previousDraws = currentMatch.teamDraws
      ? { ...currentMatch.teamDraws }
      : {};
    const previousSnakeDraws = currentMatch.team_draws
      ? { ...currentMatch.team_draws }
      : null;
    const previousVotes = {
      best_player: [...(currentMatch.votes?.best_player || [])],
      worst_player: [...(currentMatch.votes?.worst_player || [])],
    };

    // Remove da lista de jogadores
    const nextPlayers = currentMatch.players.filter((p) => {
      if (!p || !p.username) return false;
      return normalizeTeamKey(p.username) !== usernameKey;
    });
    if (nextPlayers.length === currentMatch.players.length) {
      FMModal.warning("Jogador nao encontrado na lista de confirmados.");
      return;
    }
    currentMatch.players = nextPlayers;

    currentMatch.votes = currentMatch.votes || {
      best_player: [],
      worst_player: [],
    };
    currentMatch.votes.best_player = (
      currentMatch.votes.best_player || []
    ).filter((vote) => {
      return (
        normalizeTeamKey(vote?.voter) !== usernameKey &&
        normalizeTeamKey(vote?.candidate) !== usernameKey
      );
    });
    currentMatch.votes.worst_player = (
      currentMatch.votes.worst_player || []
    ).filter((vote) => {
      return (
        normalizeTeamKey(vote?.voter) !== usernameKey &&
        normalizeTeamKey(vote?.candidate) !== usernameKey
      );
    });

    // Limpa o sorteio (teamDraws) para permitir novo sorteio
    if (currentMatch.teamDraws && currentMatch.teamDraws[usernameKey]) {
      delete currentMatch.teamDraws[usernameKey];
    }
    if (currentMatch.team_draws && currentMatch.team_draws[usernameKey]) {
      delete currentMatch.team_draws[usernameKey];
    }

    try {
      await updateMatchRoster(currentMatch, "remover jogadores");
      FMModal.success(`Jogador "${username}" removido com sucesso!`);
      loadAndRenderPage();
    } catch (error) {
      currentMatch.players = previousPlayers;
      currentMatch.teamDraws = previousDraws;
      if (previousSnakeDraws) {
        currentMatch.team_draws = previousSnakeDraws;
      } else {
        delete currentMatch.team_draws;
      }
      currentMatch.votes = previousVotes;
      console.error("Erro ao remover jogador:", error);
      FMModal.error(
        error?.message || "Erro ao remover jogador. Tente novamente.",
      );
    }
  }

  function handlePlayerListAdminClick(event) {
    const releaseButton = event.target.closest(".btn-release-draw");
    if (releaseButton) {
      event.preventDefault();
      handleReleasePlayerDraw({ currentTarget: releaseButton });
      return;
    }

    const removeButton = event.target.closest(".btn-remove-player");
    if (removeButton) {
      event.preventDefault();
      handleRemovePlayer({ currentTarget: removeButton });
    }
  }

  async function handleReleasePlayerDraw(event) {
    const username = event.currentTarget.dataset.username;
    const usernameKey = normalizeTeamKey(username);
    const player = getMatchPlayer(username);

    if (!player) {
      FMModal.warning("Jogador nao encontrado na lista de confirmados.");
      return;
    }

    const releaseConfirmed = await FMModal.confirm({
      type: "draw",
      title: "Liberar novo sorteio",
      message: `Liberar um novo sorteio para "${username}"? Ele continua confirmado, mas precisa raspar novamente para receber outro time.`,
      confirmLabel: "Liberar sorteio",
      priority: 80,
    });
    if (!releaseConfirmed) {
      return;
    }

    const previousPlayer = { ...player };
    const previousDraws = currentMatch.teamDraws
      ? { ...currentMatch.teamDraws }
      : {};
    const previousSnakeDraws = currentMatch.team_draws
      ? { ...currentMatch.team_draws }
      : null;

    delete player.teamId;
    delete player.teamName;
    delete player.assignmentMode;
    delete player.drawnAt;

    if (currentMatch.teamDraws && currentMatch.teamDraws[usernameKey]) {
      delete currentMatch.teamDraws[usernameKey];
    }
    if (currentMatch.team_draws && currentMatch.team_draws[usernameKey]) {
      delete currentMatch.team_draws[usernameKey];
    }

    try {
      await releasePlayerDraw(currentMatch.id, username);
      FMModal.drawConfirm(`Novo sorteio liberado para "${username}".`);
      loadAndRenderPage();
    } catch (error) {
      Object.keys(player).forEach((key) => delete player[key]);
      Object.assign(player, previousPlayer);
      currentMatch.teamDraws = previousDraws;
      if (previousSnakeDraws) {
        currentMatch.team_draws = previousSnakeDraws;
      } else {
        delete currentMatch.team_draws;
      }
      console.error("Erro ao liberar novo sorteio:", error);
      FMModal.error(
        error?.message || "Erro ao liberar novo sorteio. Tente novamente.",
      );
    }
  }

  async function handlePlayerTeamChange(event) {
    const username = event.currentTarget.dataset.username;
    const selectedTeamId = event.currentTarget.value;
    const player = currentMatch.players.find((p) => p.username === username);
    if (!player) return;

    const previousPlayer = { ...player };
    const selectedTeam = selectedTeamId ? getTeamById(selectedTeamId) : null;

    if (selectedTeam) {
      player.teamId = selectedTeam.id;
      player.teamName = selectedTeam.name;
      player.assignmentMode = "manual";
    } else {
      delete player.teamId;
      delete player.teamName;
      player.assignmentMode = "manual";
    }

    try {
      await addMatch(currentMatch);
      loadAndRenderPage();
    } catch (error) {
      Object.keys(player).forEach((key) => delete player[key]);
      Object.assign(player, previousPlayer);
      console.error("Erro ao mover jogador:", error);
      FMModal.error(
        error?.message || "Erro ao mover jogador. Tente novamente.",
      );
    }
  }

  function handleWhatsAppPlayer(event) {
    const phone = event.currentTarget.dataset.phone;
    const username = event.currentTarget.dataset.username;

    if (!phone) {
      FMModal.warning("Este jogador nao cadastrou um numero de celular.");
      return;
    }

    // Formatar data da partida
    const [year, month, day] = currentMatch.date.split("-");
    const formattedDate = `${day}/${month}/${year}`;

    // Mensagem pré-formatada
    const message =
      `*⚽ Futebol Milhão - Mensagem do Admin*\n\n` +
      `Olá *${username}*! 👋\n\n` +
      `Partida: *${currentMatch.location}*\n` +
      `Data: *${formattedDate}* às *${currentMatch.time}h*\n` +
      `Valor: *R$ ${currentMatch.playerFee.toFixed(2).replace(".", ",")}*\n\n` +
      `📩 `;

    // Formatar número (adicionar 55 se não tiver)
    let formattedPhone = phone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("55")) {
      formattedPhone = "55" + formattedPhone;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  }

  // ===== DESISTÊNCIA DO JOGADOR (SEM REMOÇÃO DA LISTA) =====
  async function confirmLeaveMatch(reason) {
    if (!reason.trim()) {
      FMModal.warning("Por favor, informe o motivo.");
      return;
    }

    // Exibe processamento global para evitar duplo envio.
    const loadingModal = FMModal.loading({
      title: "Registrando desistencia",
      message: "Salvando a desistencia no servidor...",
    });

    try {
      // 1. Registrar desistência no backend (marca como 'withdrew', NÃO remove da lista)
      await playerWithdrawFromMatch(currentMatch.id, reason.trim());

      // 2. Montar mensagem para o administrador via WhatsApp
      const date = new Date(`${currentMatch.date}T00:00:00`);
      const weekDay = date.toLocaleDateString("pt-BR", { weekday: "long" });
      const formattedDate = date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      });

      const message =
        `*⚠️ DESISTÊNCIA DE JOGADOR*\n\n` +
        `*Partida:* Futebol ${weekDay} na ${currentMatch.location}\n` +
        `*Data:* ${formattedDate} às ${currentMatch.time}h\n\n` +
        `*Jogador:* ${currentUser.username}\n` +
        `*Motivo:* ${reason.trim()}\n\n` +
        `_O jogador permanece na lista como desistente. Remova manualmente se necessário._`;

      const adminPhoneNumber = await getConfig("admin_whatsapp");
      if (!adminPhoneNumber) {
        loadingModal.close();
        FMModal.warning("Número do administrador não configurado.");
        return;
      }
      const whatsappUrl = `https://api.whatsapp.com/send?phone=${adminPhoneNumber}&text=${encodeURIComponent(message)}`;

      // 3. Abrir WhatsApp
      window.open(whatsappUrl, "_blank");

      loadingModal.close();
      FMModal.success(
        "Sua desistência foi registrada com sucesso.\nVocê permanece na lista, mas sem time.\nO administrador foi notificado.",
      );
      loadAndRenderPage();
    } catch (error) {
      loadingModal.close();
      console.error("Erro ao registrar desistência:", error);
      FMModal.error(
        error?.message || "Erro ao registrar desistência. Tente novamente.",
      );
    }
  }

  async function handlePaymentChange(event) {
    const username = event.target.dataset.username;
    const player = currentMatch.players.find((p) => p.username === username);
    if (player) {
      player.paid = event.target.checked;
      try {
        await addMatch(currentMatch);
        if (player.paid) await clearPlayerStats(player.username);
        loadAndRenderPage();
      } catch (error) {
        FMModal.error("Erro ao atualizar pagamento.");
      }
    }
  }

  async function updateMatchStatus(newStatus) {
    if (!currentMatch) return;
    const oldStatus = currentMatch.status;
    currentMatch.status = newStatus;
    if (newStatus === "ENCERRADA" && oldStatus !== "ENCERRADA") {
      const deadline = new Date();
      deadline.setHours(deadline.getHours() + 24);
      currentMatch.voting_deadline = deadline.toISOString();
    }
    try {
      await addMatch(currentMatch);
      if (newStatus === "ENCERRADA") {
        FMModal.voteOpen({
          title: "Votacao aberta",
          message:
            "A partida foi encerrada. A votacao pos-jogo esta aberta por 24 horas.",
        });
      } else {
        FMModal.success(`Status da partida atualizado para: ${newStatus}`);
      }
      loadAndRenderPage();

      // Notificação WhatsApp para administrador
      if (currentUser.role === "admin") {
        const adminPhoneNumber = await getConfig("admin_whatsapp");
        if (adminPhoneNumber) {
          const [year, month, day] = currentMatch.date.split("-");
          const formattedDate = `${day}/${month}/${year}`;
          const message =
            `📢 *ATENÇÃO! Status da Partida Alterado!* 📢\n\n` +
            `*Partida:* ${currentMatch.location} - ${formattedDate} às ${currentMatch.time}h\n` +
            `*Status Anterior:* ${oldStatus}\n` +
            `*Novo Status:* ${newStatus}\n\n` +
            `*Acesse o app para mais detalhes!*`;

          const whatsappUrl = `https://api.whatsapp.com/send?phone=${adminPhoneNumber}&text=${encodeURIComponent(message)}`;

          const confirmSend = await FMModal.confirm({
            type: "admin",
            title: "Enviar notificacao",
            message: "Deseja enviar esta notificacao para o grupo do WhatsApp?",
            details: message,
            confirmLabel: "Enviar",
            cancelLabel: "Nao enviar",
            priority: 70,
          });
          if (confirmSend) {
            window.open(whatsappUrl, "_blank");
          }
        } else {
          FMModal.warning(
            "Numero do administrador nao configurado para notificacoes WhatsApp.",
          );
        }
      }
    } catch (error) {
      currentMatch.status = oldStatus;
      FMModal.error("Nao foi possivel atualizar o status.");
    }
  }

  async function processVotingResults(match) {
    const { best_player, worst_player } = match.votes;
    const findWinner = (votes) => {
      if (!votes || votes.length === 0) return null;
      const voteCounts = votes.reduce((acc, vote) => {
        acc[vote.candidate] = (acc[vote.candidate] || 0) + 1;
        return acc;
      }, {});
      const sortedVotes = Object.entries(voteCounts).sort(
        (a, b) => b[1] - a[1],
      );
      return sortedVotes.length > 0 ? sortedVotes[0][0] : null;
    };
    const bestPlayerWinner = findWinner(best_player);
    const worstPlayerWinner = findWinner(worst_player);

    let alertMessage = "Votação Apurada!\n";
    if (bestPlayerWinner) {
      alertMessage += `\n⭐ Craque da Partida: ${bestPlayerWinner}`;
    }
    if (worstPlayerWinner) {
      alertMessage += `\n🪵 Perna de Pau: ${worstPlayerWinner}`;
    }
    if (!bestPlayerWinner && !worstPlayerWinner) {
      alertMessage += `\nNenhum voto foi registrado.`;
    }

    match.results_processed = true;
    await addMatch(match);
    FMModal.voteOpen({
      title: "Votacao apurada",
      message: alertMessage,
    });
    loadAndRenderPage();
  }

  async function handleVote(event) {
    const button = event.target;
    if (button.disabled || button.classList.contains("voted")) return;

    const candidateName = button.dataset.playerName;
    const category = button.dataset.category;

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "...";

    try {
      const client =
        typeof getSupabaseClient === "function"
          ? getSupabaseClient()
          : window.supabaseClient;
      if (!client) throw new Error("Falha na conexão com o servidor.");

      // RPC que bloqueia usando UNIQUE Constraint de match_id + user_id + category
      const { data, error } = await client.rpc("submit_match_vote", {
        p_match_id: currentMatch.id,
        p_voter_username: currentUser.username,
        p_candidate_username: candidateName,
        p_category: category,
      });

      if (error) {
        if (
          error.code === "23505" ||
          (error.message && error.message.includes("unique_violation"))
        ) {
          throw new Error("Você já registrou seu voto nesta categoria.");
        }
        throw error;
      }

      // Voto validado no backend! Atualizamos a interface.
      const newVote = { voter: currentUser.username, candidate: candidateName };
      currentMatch.votes[category].push(newVote);

      // Re-renderiza para calcular as barras e botões
      loadAndRenderPage();
    } catch (error) {
      console.error("Erro ao votar:", error);
      FMModal.error(
        error.message ||
          "Nao foi possivel registrar seu voto. Tente novamente.",
      );
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function createActionButton(text, className, onClick) {
    const button = document.createElement("button");
    button.className = `btn ${className}`;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function createAdminButton(text, className, onClick) {
    const button = document.createElement("button");
    button.className = `btn ${className}`;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function createCandidateElement(player, voteCount, category, userHasVoted) {
    const div = document.createElement("div");
    div.className = "vote-candidate";
    const hasVotedForThis = currentMatch.votes[category].some(
      (v) =>
        v.voter === currentUser.username && v.candidate === player.username,
    );
    const isSelf =
      normalizeTeamKey(player.username) ===
      normalizeTeamKey(currentUser.username);
    const isVisitor = currentUser.role === "visitor";

    // Determinar se o botão deve estar desabilitado
    const isDisabled =
      isVisitor || userHasVoted || isSelf || currentMatch.results_processed;

    // Tooltip para auto-voto
    let tooltipText = "";
    if (isSelf) tooltipText = "Você não pode votar em si mesmo";
    else if (isVisitor) tooltipText = "Visitantes não podem votar";
    else if (userHasVoted) tooltipText = "Você já votou nesta categoria";

    // Calcular porcentagem visual
    const totalVotes = currentMatch.votes[category].length;
    const percentage =
      totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
    const barColor =
      category === "best_player"
        ? "var(--accent-green, #10b981)"
        : "var(--accent-red, #ef4444)";

    div.innerHTML = `
            <div class="vote-candidate-info">
                <span class="player-name${isSelf ? " is-self" : ""}">${player.username}${isSelf ? ' <span class="self-tag">(você)</span>' : ""}</span>
                <div class="vote-bar-container">
                    <div class="vote-bar-fill" style="width: ${percentage}%; background: ${barColor};"></div>
                </div>
            </div>
            <div class="vote-candidate-actions">
                <span class="vote-count">${voteCount}</span>
                <button class="vote-button ${hasVotedForThis ? "voted" : ""} ${isSelf ? "self-disabled" : ""}" 
                        data-player-name="${player.username}" 
                        data-category="${category}" 
                        ${isDisabled ? "disabled" : ""}
                        ${tooltipText ? `title="${tooltipText}"` : ""}>
                    ${hasVotedForThis ? "✔ Votado" : isSelf ? "—" : "Votar"}
                </button>
            </div>`;
    const voteButton = div.querySelector(".vote-button");
    if (!voteButton.disabled) {
      voteButton.addEventListener("click", handleVote);
    }
    return div;
  }

  // ===== COMPARTILHAMENTO PÓS-SORTEIO VIA WHATSAPP (ETAPA 4) =====
  async function handleShareTeamList() {
    const teams = getMatchTeams();
    if (teams.length === 0) {
      FMModal.warning("Nenhum time cadastrado nesta partida.");
      return;
    }

    const activePlayers = currentMatch.players.filter(
      (p) => p.status !== "withdrew" && p.status !== "removed",
    );

    // Emojis para times por posição
    const teamEmojis = [
      "🔴",
      "🔵",
      "⚫",
      "🟢",
      "🟡",
      "🟣",
      "🟠",
      "🔷",
      "💗",
      "✨",
    ];

    // Organizar jogadores por time (usando Set para evitar duplicidade)
    const playersByTeam = new Map();
    const assignedPlayers = new Set();

    teams.forEach((team) => {
      playersByTeam.set(team.id, []);
    });

    // Primeira passagem: jogadores com time atribuído
    activePlayers.forEach((player) => {
      const teamId = player.teamId;
      const drawKey = getDrawKey(player.username);
      const drawData = currentMatch.teamDraws?.[drawKey];

      const finalTeamId = teamId || drawData?.teamId;

      if (
        finalTeamId &&
        playersByTeam.has(finalTeamId) &&
        !assignedPlayers.has(drawKey)
      ) {
        playersByTeam.get(finalTeamId).push(player.username);
        assignedPlayers.add(drawKey);
      }
    });

    // Jogadores sem time
    const unassigned = activePlayers.filter((p) => {
      const drawKey = getDrawKey(p.username);
      return !assignedPlayers.has(drawKey);
    });

    // Formatar data
    const [year, month, day] = currentMatch.date.split("-");
    const formattedDate = `${day}/${month}/${year}`;

    // Construir mensagem
    let message = `🏆 *TIMES DA PARTIDA*\n`;
    message += `📅 ${formattedDate} às ${currentMatch.time}h\n`;
    message += `📍 ${currentMatch.location}\n\n`;

    teams.forEach((team, index) => {
      const emoji = teamEmojis[index % teamEmojis.length];
      const players = playersByTeam.get(team.id) || [];

      message += `${emoji} *${team.name.toUpperCase()}*\n`;
      if (players.length > 0) {
        players.forEach((name) => {
          message += `   • ${name}\n`;
        });
      } else {
        message += `   _Nenhum jogador_\n`;
      }
      message += `\n`;
    });

    // Jogadores sem time
    if (unassigned.length > 0) {
      message += `⚪ *SEM TIME*\n`;
      unassigned.forEach((p) => {
        message += `   • ${p.username}\n`;
      });
      message += `\n`;
    }

    message += `📊 Total: ${activePlayers.length} jogadores\n`;
    message += `_Gerado automaticamente pelo Futebol Milhão_`;

    // Buscar número do admin
    const adminPhone = await getConfig("admin_whatsapp");
    if (!adminPhone) {
      FMModal.warning("Número do administrador não configurado.");
      return;
    }
    let formattedPhone = adminPhone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("55")) {
      formattedPhone = "55" + formattedPhone;
    }

    const whatsappUrl = `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  }

  window.addEventListener("beforeunload", unsubscribeMatchRealtime);

  loadAndRenderPage();
});
