(async function () {
  // Fallback, será sobrescrito pelo banco
  let DEADLINE = new Date("2026-05-18T22:00:00-03:00");
  let countdownInterval = null;

  const alertEl = document.getElementById("payment-alert");
  const countdownBox = document.querySelector(".countdown-box");
  const daysEl = document.getElementById("countdown-days");
  const hoursEl = document.getElementById("countdown-hours");
  const minutesEl = document.getElementById("countdown-minutes");
  const secondsEl = document.getElementById("countdown-seconds");
  const btnEarly = document.getElementById("btn-pix-early");
  const btnRegular = document.getElementById("btn-pix-regular");
  const btnGoalkeeper = document.getElementById("btn-pix-goalkeeper");

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function setCountdown(days, hours, minutes, seconds) {
    if (daysEl) daysEl.textContent = pad(days);
    if (hoursEl) hoursEl.textContent = pad(hours);
    if (minutesEl) minutesEl.textContent = pad(minutes);
    if (secondsEl) secondsEl.textContent = pad(seconds);
  }

  function setExpiredState() {
    if (alertEl) {
      alertEl.textContent = "Prazo promocional encerrado";
      alertEl.classList.add("is-expired");
    }

    if (countdownBox) {
      countdownBox.classList.add("is-expired");
      const title = countdownBox.querySelector(".countdown-title");
      if (title) title.textContent = "Prazo do valor antecipado encerrado";
    }

    setCountdown(0, 0, 0, 0);

    if (btnEarly && !btnEarly.classList.contains("is-disabled")) {
      btnEarly.classList.add("is-disabled");
      btnEarly.removeAttribute("href");
      btnEarly.style.opacity = "0.4";
      btnEarly.style.pointerEvents = "none";
      const sub = btnEarly.querySelector("span:last-child");
      if (sub) sub.textContent = "Encerrado";
    }
  }

  function updateCountdown() {
    const now = new Date();
    const diff = DEADLINE.getTime() - now.getTime();

    if (diff <= 0) {
      setExpiredState();
      return;
    }

    if (alertEl) {
      alertEl.textContent = "Garanta por R$ 10,00 até o prazo!";
      alertEl.classList.remove("is-expired");
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    setCountdown(days, hours, minutes, seconds);
  }

  function setupPaymentButton(buttonEl, link) {
    if (!buttonEl) return;

    if (!link) {
      buttonEl.classList.add("is-disabled");
      buttonEl.removeAttribute("href");
      buttonEl.setAttribute("aria-disabled", "true");
      buttonEl.style.opacity = "0.5";
      buttonEl.style.pointerEvents = "none";
      const text = buttonEl.querySelector(".pix-button-text");
      if (text) text.textContent = "Indisponível";
      return;
    }

    buttonEl.setAttribute("href", link);
    buttonEl.addEventListener("click", function (event) {
      event.preventDefault();
      
      const textEl = buttonEl.querySelector(".pix-button-text");
      const originalText = textEl ? textEl.textContent : "";
      
      buttonEl.classList.add("is-loading");
      buttonEl.setAttribute("aria-busy", "true");
      if (textEl) textEl.textContent = "Abrindo...";

      window.setTimeout(function () {
        buttonEl.classList.remove("is-loading");
        if (textEl) textEl.textContent = originalText;
        window.location.href = link;
      }, 450);
    });
  }

  try {
    await initDB();
    const currentUser = getCurrentStoredUser();
    if (!currentUser) {
      window.location.href = "../index.html";
      return;
    }

    const playerPayment = await getPlayerPaymentStatus(currentUser.id);
    if (!playerPayment?.confirmed) {
      window.location.href = "welcome.html";
      return;
    }

    if (playerPayment.payment_status === "paid") {
      FMModal.success("Pagamento já registrado. Obrigado!");
    }

    const links = await getPaymentLinks();
    
    // Atualizar data limite vinda do banco
    if (links['payment_early_enabled_until']) {
      DEADLINE = new Date(links['payment_early_enabled_until']);
    }

    // Configura botões de acordo com o status atual
    const now = new Date();
    if (now.getTime() > DEADLINE.getTime()) {
      setupPaymentButton(btnEarly, null); // Expired
      setExpiredState();
    } else {
      setupPaymentButton(btnEarly, links['payment_link_early_player']);
    }

    setupPaymentButton(btnRegular, links['payment_link_regular_player']);
    setupPaymentButton(btnGoalkeeper, links['payment_link_goalkeeper']);
    
    updateCountdown();
    countdownInterval = window.setInterval(updateCountdown, 1000);

  } catch (error) {
    console.error("Erro ao carregar dados de pagamento:", error);
    if (alertEl) {
      alertEl.textContent = "Erro ao carregar os dados de pagamento. Tente novamente mais tarde.";
    }
    setupPaymentButton(btnEarly, null);
    setupPaymentButton(btnRegular, null);
    setupPaymentButton(btnGoalkeeper, null);
  }

})();
