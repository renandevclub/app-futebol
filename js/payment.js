(async function () {
  const DEADLINE = new Date("2026-05-17T23:59:59-03:00");

  const alertEl = document.getElementById("payment-alert");
  const countdownBox = document.querySelector(".countdown-box");
  const daysEl = document.getElementById("countdown-days");
  const hoursEl = document.getElementById("countdown-hours");
  const minutesEl = document.getElementById("countdown-minutes");
  const secondsEl = document.getElementById("countdown-seconds");
  const button = document.getElementById("pix-button");

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
      alertEl.textContent = "Valor atualizado: R$ 15,00";
      alertEl.classList.add("is-expired");
    }

    if (countdownBox) {
      countdownBox.classList.add("is-expired");
      const title = countdownBox.querySelector(".countdown-title");
      if (title) title.textContent = "Prazo do valor antecipado encerrado";
    }

    setCountdown(0, 0, 0, 0);
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

  function renderPaymentButton(paymentLink) {
    if (!button) return;

    if (!paymentLink) {
      button.classList.add("is-disabled");
      button.removeAttribute("href");
      button.setAttribute("aria-disabled", "true");
      const text = button.querySelector(".pix-button-text");
      if (text) text.textContent = "Link do Pix indisponível";
      return;
    }

    button.setAttribute("href", paymentLink);
    button.addEventListener("click", function (event) {
      if (!paymentLink) {
        event.preventDefault();
        return;
      }

      const text = button.querySelector(".pix-button-text");
      button.classList.add("is-loading");
      button.setAttribute("aria-busy", "true");
      if (text) text.textContent = "Abrindo Pix...";

      window.setTimeout(function () {
        window.location.href = paymentLink;
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

    const paymentLink = await getPaymentLink();
    renderPaymentButton(paymentLink);
  } catch (error) {
    console.error("Erro ao carregar dados de pagamento:", error);
    if (alertEl) {
      alertEl.textContent = "Erro ao carregar o link de pagamento. Tente novamente mais tarde.";
    }
    renderPaymentButton(null);
  }

  updateCountdown();
  window.setInterval(updateCountdown, 1000);
})();
