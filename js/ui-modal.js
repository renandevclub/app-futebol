(function () {
  "use strict";

  if (window.FMModal) return;

  const nativeAlert = window.alert ? window.alert.bind(window) : null;
  const nativeConfirm = window.confirm ? window.confirm.bind(window) : null;
  const nativePrompt = window.prompt ? window.prompt.bind(window) : null;

  const TYPE_META = {
    info: { title: "Informacao", icon: "i", accent: "#38bdf8" },
    alert: { title: "Atencao", icon: "!", accent: "#f59e0b" },
    warning: { title: "Atencao", icon: "!", accent: "#f59e0b" },
    error: { title: "Erro", icon: "x", accent: "#ef4444" },
    success: { title: "Sucesso", icon: "✓", accent: "#10b981" },
    confirm: { title: "Confirmar acao", icon: "?", accent: "#8b5cf6" },
    quick: { title: "Acoes rapidas", icon: "+", accent: "#22c55e" },
    system: { title: "Sistema", icon: "•", accent: "#3b82f6" },
    realtime: {
      title: "Atualizacao em tempo real",
      icon: "~",
      accent: "#06b6d4",
    },
    vote: { title: "Votacao aberta", icon: "★", accent: "#f59e0b" },
    draw: { title: "Confirmacao de sorteio", icon: "#", accent: "#10b981" },
    admin: { title: "Mensagem administrativa", icon: "A", accent: "#8b5cf6" },
    loading: { title: "Processando", icon: "", accent: "#10b981" },
  };

  let sequence = 0;
  let activeItem = null;
  let lastFocusedElement = null;
  const queue = [];
  const state = {
    root: null,
    notificationStack: null,
    keydownHandler: null,
  };

  function ensureStyles() {
    if (document.getElementById("fm-modal-styles")) return;

    const style = document.createElement("style");
    style.id = "fm-modal-styles";
    style.textContent = `
            .fm-modal-layer {
                position: fixed;
                inset: 0;
                z-index: 9999;
                pointer-events: none;
                font-family: var(--font-family, 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            }

            .fm-modal-layer.is-active {
                pointer-events: auto;
            }

            .fm-modal-backdrop {
                position: absolute;
                inset: 0;
                display: grid;
                place-items: center;
                padding: 24px;
                background: rgba(2, 6, 23, 0.76);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                opacity: 0;
                transition: opacity 180ms ease;
            }

            .fm-modal-layer.is-visible .fm-modal-backdrop {
                opacity: 1;
            }

            .fm-modal-card {
                width: min(94vw, var(--fm-modal-width, 480px));
                max-height: min(86vh, 680px);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                color: var(--text-main, #f8fafc);
                background:
                    linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(17, 24, 39, 0.96)),
                    radial-gradient(circle at top left, rgba(16, 185, 129, 0.18), transparent 35%);
                border: 1px solid rgba(255, 255, 255, 0.13);
                border-top-color: color-mix(in srgb, var(--fm-modal-accent, #10b981) 48%, rgba(255,255,255,0.18));
                border-radius: 18px;
                box-shadow: 0 26px 90px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(255,255,255,0.03) inset;
                transform: translateY(18px) scale(0.98);
                opacity: 0;
                transition: transform 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease;
            }

            .fm-modal-layer.is-visible .fm-modal-card {
                transform: translateY(0) scale(1);
                opacity: 1;
            }

            .fm-modal-header {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 14px;
                align-items: start;
                padding: 22px 22px 12px;
            }

            .fm-modal-icon {
                width: 38px;
                height: 38px;
                display: inline-grid;
                place-items: center;
                border-radius: 999px;
                color: #ffffff;
                background: linear-gradient(135deg, var(--fm-modal-accent, #10b981), color-mix(in srgb, var(--fm-modal-accent, #10b981) 72%, #020617));
                box-shadow: 0 0 0 6px color-mix(in srgb, var(--fm-modal-accent, #10b981) 16%, transparent);
                font-size: 1rem;
                font-weight: 800;
                line-height: 1;
                text-transform: uppercase;
            }

            .fm-modal-icon.is-loading {
                border: 3px solid rgba(255,255,255,0.18);
                border-top-color: var(--fm-modal-accent, #10b981);
                background: transparent;
                box-shadow: none;
                animation: fm-spin 0.9s linear infinite;
            }

            .fm-modal-title {
                margin: 0;
                color: var(--text-main, #f8fafc);
                font-size: clamp(1.05rem, 2.5vw, 1.28rem);
                line-height: 1.22;
                letter-spacing: 0;
            }

            .fm-modal-kicker {
                display: block;
                margin-bottom: 4px;
                color: var(--fm-modal-accent, #10b981);
                font-size: 0.72rem;
                line-height: 1.2;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }

            .fm-modal-close {
                width: 34px;
                height: 34px;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 10px;
                display: inline-grid;
                place-items: center;
                color: var(--text-secondary, #cbd5e1);
                background: rgba(255, 255, 255, 0.05);
                cursor: pointer;
                transition: transform 140ms ease, background 140ms ease, color 140ms ease;
            }

            .fm-modal-close:hover {
                color: #ffffff;
                background: rgba(255, 255, 255, 0.11);
                transform: translateY(-1px);
            }

            .fm-modal-body {
                padding: 4px 22px 18px;
                overflow: auto;
                color: var(--text-secondary, #cbd5e1);
                font-size: 0.98rem;
            }

            .fm-modal-body p {
                margin: 0 0 12px;
            }

            .fm-modal-body p:last-child {
                margin-bottom: 0;
            }

            .fm-modal-detail {
                margin-top: 14px;
                padding: 13px 14px;
                border-radius: 12px;
                color: var(--text-main, #f8fafc);
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.09);
                white-space: pre-wrap;
                word-break: break-word;
            }

            .fm-modal-field {
                margin-top: 14px;
                display: grid;
                gap: 8px;
            }

            .fm-modal-field label {
                color: var(--text-main, #f8fafc);
                font-size: 0.86rem;
                font-weight: 700;
            }

            .fm-modal-field textarea,
            .fm-modal-field input {
                width: 100%;
                min-height: 112px;
                resize: vertical;
                color: var(--text-main, #f8fafc);
                background: rgba(2, 6, 23, 0.56);
                border: 1px solid rgba(255,255,255,0.13);
                border-radius: 12px;
                padding: 12px 13px;
                font: inherit;
                line-height: 1.45;
            }

            .fm-modal-field input {
                min-height: 44px;
            }

            .fm-modal-field textarea:focus,
            .fm-modal-field input:focus {
                outline: none;
                border-color: var(--fm-modal-accent, #10b981);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--fm-modal-accent, #10b981) 22%, transparent);
            }

            .fm-modal-field-error {
                min-height: 18px;
                color: #fca5a5;
                font-size: 0.82rem;
                font-weight: 700;
            }

            .fm-modal-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 16px 22px 22px;
                border-top: 1px solid rgba(255,255,255,0.08);
                background: rgba(2, 6, 23, 0.18);
            }

            .fm-modal-action {
                min-height: 42px;
                padding: 10px 16px;
                border-radius: 11px;
                border: 1px solid rgba(255,255,255,0.13);
                color: var(--text-main, #f8fafc);
                background: rgba(255,255,255,0.08);
                font: inherit;
                font-weight: 800;
                cursor: pointer;
                transition: transform 140ms ease, filter 140ms ease, background 140ms ease;
            }

            .fm-modal-action:hover {
                transform: translateY(-1px);
                filter: brightness(1.06);
            }

            .fm-modal-action[data-variant="primary"] {
                color: #ffffff;
                border-color: transparent;
                background: linear-gradient(135deg, var(--fm-modal-accent, #10b981), color-mix(in srgb, var(--fm-modal-accent, #10b981) 74%, #020617));
                box-shadow: 0 10px 28px color-mix(in srgb, var(--fm-modal-accent, #10b981) 24%, transparent);
            }

            .fm-modal-action[data-variant="danger"] {
                color: #ffffff;
                border-color: transparent;
                background: linear-gradient(135deg, #ef4444, #b91c1c);
                box-shadow: 0 10px 28px rgba(239, 68, 68, 0.24);
            }

            .fm-modal-action[data-variant="ghost"] {
                color: var(--text-secondary, #cbd5e1);
                background: transparent;
            }

            .fm-toast-stack {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 10000;
                display: grid;
                gap: 10px;
                width: min(420px, calc(100vw - 28px));
                pointer-events: none;
            }

            .fm-toast {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 12px;
                align-items: start;
                padding: 14px 14px;
                color: var(--text-main, #f8fafc);
                background: rgba(15, 23, 42, 0.96);
                border: 1px solid rgba(255,255,255,0.12);
                border-left: 4px solid var(--fm-toast-accent, #10b981);
                border-radius: 14px;
                box-shadow: 0 18px 48px rgba(0,0,0,0.38);
                opacity: 0;
                transform: translateY(12px);
                transition: opacity 160ms ease, transform 180ms ease;
                pointer-events: auto;
            }

            .fm-toast.is-visible {
                opacity: 1;
                transform: translateY(0);
            }

            .fm-toast strong {
                display: block;
                margin-bottom: 2px;
                font-size: 0.92rem;
            }

            .fm-toast span {
                display: block;
                color: var(--text-secondary, #cbd5e1);
                font-size: 0.86rem;
                line-height: 1.35;
            }

            .fm-toast-close {
                border: 0;
                color: var(--text-secondary, #cbd5e1);
                background: transparent;
                cursor: pointer;
                font-size: 1.05rem;
                line-height: 1;
            }

            body.fm-modal-open {
                overflow: hidden;
            }

            @keyframes fm-spin {
                to { transform: rotate(360deg); }
            }

            @media (max-width: 560px) {
                .fm-modal-backdrop {
                    align-items: end;
                    padding: 12px;
                }

                .fm-modal-card {
                    width: 100%;
                    max-height: 88vh;
                    border-radius: 18px 18px 14px 14px;
                }

                .fm-modal-header {
                    padding: 18px 16px 10px;
                    grid-template-columns: auto 1fr auto;
                }

                .fm-modal-body {
                    padding: 4px 16px 16px;
                }

                .fm-modal-actions {
                    padding: 14px 16px 16px;
                    flex-direction: column-reverse;
                }

                .fm-modal-action {
                    width: 100%;
                }

                .fm-toast-stack {
                    right: 12px;
                    bottom: 12px;
                    width: calc(100vw - 24px);
                }
            }
        `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    if (!document.body) return null;
    ensureStyles();

    if (!state.root) {
      state.root = document.createElement("div");
      state.root.className = "fm-modal-layer";
      state.root.setAttribute("aria-live", "polite");
      document.body.appendChild(state.root);
    }

    if (!state.notificationStack) {
      state.notificationStack = document.createElement("div");
      state.notificationStack.className = "fm-toast-stack";
      state.notificationStack.setAttribute("aria-live", "polite");
      document.body.appendChild(state.notificationStack);
    }

    return state.root;
  }

  function metaFor(type) {
    return TYPE_META[type] || TYPE_META.info;
  }

  function normalizeOptions(input, defaults) {
    const base = defaults || {};
    if (typeof input === "string") {
      return { ...base, message: input };
    }
    return { ...base, ...(input || {}) };
  }

  function normalizeType(type) {
    if (type === "quick-actions") return "quick";
    if (type === "vote-open") return "vote";
    if (type === "draw-confirm") return "draw";
    return type || "info";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\\]]/g, "\\$&");
  }

  function messageHtml(message) {
    const text = String(message ?? "");
    if (!text) return "";
    return text
      .split(/\n{2,}/)
      .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function defaultActions(options) {
    if (options.type === "loading") return [];

    if (options.actions && Array.isArray(options.actions)) {
      return options.actions.map((action) => ({
        id: action.id || action.value || action.label,
        label: action.label || "OK",
        value: action.value,
        variant: action.variant || "secondary",
        closes: action.closes !== false,
      }));
    }

    if (options.type === "confirm" || options.confirm === true) {
      return [
        {
          id: "cancel",
          label: options.cancelLabel || "Cancelar",
          value: false,
          variant: "ghost",
          closes: true,
        },
        {
          id: "confirm",
          label: options.confirmLabel || "Confirmar",
          value: true,
          variant: options.danger ? "danger" : "primary",
          closes: true,
        },
      ];
    }

    return [
      {
        id: "ok",
        label: options.okLabel || "OK",
        value: true,
        variant: "primary",
        closes: true,
      },
    ];
  }

  function show(input) {
    const options = normalizeOptions(input, {});
    options.type = normalizeType(options.type);
    options.priority = Number.isFinite(options.priority)
      ? options.priority
      : 10;
    options.id = options.id || `fm_modal_${Date.now()}_${sequence++}`;
    options.createdAt = Date.now();

    return new Promise((resolve) => {
      const item = { options, resolve, order: sequence++ };
      queue.push(item);
      queue.sort((a, b) => {
        if (b.options.priority !== a.options.priority) {
          return b.options.priority - a.options.priority;
        }
        return a.order - b.order;
      });
      pumpQueue();
    });
  }

  function pumpQueue() {
    if (activeItem || queue.length === 0) return;
    const root = ensureRoot();
    if (!root) {
      const item = queue.shift();
      if (nativeAlert && item.options.message)
        nativeAlert(item.options.message);
      item.resolve({ action: "fallback", value: true, values: {} });
      return;
    }

    activeItem = queue.shift();
    renderActiveItem();
  }

  function renderActiveItem() {
    const item = activeItem;
    if (!item) return;

    if (state.keydownHandler) {
      document.removeEventListener("keydown", state.keydownHandler);
      state.keydownHandler = null;
    }

    const root = ensureRoot();
    const options = item.options;
    const meta = metaFor(options.type);
    const title = options.title || meta.title;
    const kicker =
      options.kicker || (options.source === "realtime" ? "Tempo real" : "");
    const details = options.details
      ? `<div class="fm-modal-detail">${escapeHtml(options.details)}</div>`
      : "";
    const field = buildFieldMarkup(options);
    const actions = defaultActions(options);
    const closeButton =
      options.closeButton === false || options.type === "loading"
        ? ""
        : '<button class="fm-modal-close" type="button" data-fm-modal-close aria-label="Fechar">×</button>';
    const iconClass =
      options.type === "loading" ? "fm-modal-icon is-loading" : "fm-modal-icon";
    const bodyContent = `${messageHtml(options.message)}${details}${field}`;

    root.innerHTML = `
            <div class="fm-modal-backdrop" data-fm-modal-backdrop>
                <section class="fm-modal-card" role="dialog" aria-modal="true" aria-labelledby="${options.id}_title" style="--fm-modal-accent: ${meta.accent}; --fm-modal-width: ${options.width || "480px"};">
                    <div class="fm-modal-header">
                        <div class="${iconClass}" aria-hidden="true">${options.type === "loading" ? "" : escapeHtml(options.icon || meta.icon)}</div>
                        <div>
                            ${kicker ? `<span class="fm-modal-kicker">${escapeHtml(kicker)}</span>` : ""}
                            <h2 class="fm-modal-title" id="${options.id}_title">${escapeHtml(title)}</h2>
                        </div>
                        ${closeButton}
                    </div>
                    ${bodyContent ? `<div class="fm-modal-body">${bodyContent}</div>` : ""}
                    ${actions.length ? `<div class="fm-modal-actions">${actions.map((action) => `<button class="fm-modal-action" type="button" data-fm-action="${escapeHtml(action.id)}" data-variant="${escapeHtml(action.variant)}">${escapeHtml(action.label)}</button>`).join("")}</div>` : ""}
                </section>
            </div>
        `;

    root.classList.add("is-active");
    document.body.classList.add("fm-modal-open");
    lastFocusedElement = document.activeElement;

    bindActiveEvents(actions);

    requestAnimationFrame(() => {
      root.classList.add("is-visible");
      const focusTarget = root.querySelector(
        "[data-fm-action], textarea, input, [data-fm-modal-close]",
      );
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    });
  }

  function buildFieldMarkup(options) {
    const textarea = options.textarea;
    const input = options.input;
    const field = textarea || input;
    if (!field) return "";

    const tag = textarea ? "textarea" : "input";
    const name = field.name || "value";
    const rows = textarea ? ` rows="${field.rows || 4}"` : "";
    const type = input ? ` type="${escapeHtml(input.type || "text")}"` : "";
    const value = field.value ? escapeHtml(field.value) : "";
    const placeholder = field.placeholder
      ? ` placeholder="${escapeHtml(field.placeholder)}"`
      : "";
    const label = field.label || "Resposta";

    if (tag === "textarea") {
      return `
                <div class="fm-modal-field">
                    <label for="${name}">${escapeHtml(label)}</label>
                    <textarea id="${name}" name="${name}"${rows}${placeholder}>${value}</textarea>
                    <div class="fm-modal-field-error" data-fm-field-error></div>
                </div>
            `;
    }

    return `
            <div class="fm-modal-field">
                <label for="${name}">${escapeHtml(label)}</label>
                <input id="${name}" name="${name}"${type}${placeholder} value="${value}">
                <div class="fm-modal-field-error" data-fm-field-error></div>
            </div>
        `;
  }

  function bindActiveEvents(actions) {
    const root = state.root;
    const options = activeItem.options;

    root.querySelectorAll("[data-fm-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const actionId = button.getAttribute("data-fm-action");
        const action = actions.find((item) => String(item.id) === actionId);
        if (!action) return;
        if (!validateBeforeClose(options, action)) return;
        closeActive({
          action: action.id,
          value: action.value,
          values: readFieldValues(options),
          source: options.source || null,
        });
      });
    });

    const closeButton = root.querySelector("[data-fm-modal-close]");
    if (closeButton) {
      closeButton.addEventListener("click", () => {
        closeActive({
          action: "close",
          value: false,
          values: readFieldValues(options),
          source: options.source || null,
        });
      });
    }

    const backdrop = root.querySelector("[data-fm-modal-backdrop]");
    if (backdrop) {
      backdrop.addEventListener("click", (event) => {
        if (event.target !== backdrop) return;
        if (options.closeOnBackdrop === false || options.type === "loading")
          return;
        closeActive({
          action: "backdrop",
          value: false,
          values: readFieldValues(options),
          source: options.source || null,
        });
      });
    }

    state.keydownHandler = (event) => {
      if (!activeItem) return;

      if (event.key === "Escape") {
        if (options.closeOnEsc === false || options.type === "loading") return;
        event.preventDefault();
        closeActive({
          action: "escape",
          value: false,
          values: readFieldValues(options),
          source: options.source || null,
        });
      }

      if (event.key === "Tab") {
        keepFocusInside(event);
      }
    };
    document.addEventListener("keydown", state.keydownHandler);
  }

  function keepFocusInside(event) {
    const root = state.root;
    const focusable = Array.from(
      root.querySelectorAll(
        'button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function validateBeforeClose(options, action) {
    if (action.id !== "confirm" && action.id !== "ok") return true;

    const field = options.textarea || options.input;
    if (!field || !field.required) return true;

    const values = readFieldValues(options);
    const name = field.name || "value";
    const value = String(values[name] || "").trim();
    if (value) return true;

    const errorElement = state.root.querySelector("[data-fm-field-error]");
    if (errorElement) {
      errorElement.textContent =
        field.requiredMessage || "Preencha este campo para continuar.";
    }
    const input = state.root.querySelector(`[name="${cssEscape(name)}"]`);
    if (input) input.focus();
    return false;
  }

  function readFieldValues(options) {
    const values = {};
    const field = options.textarea || options.input;
    if (!field || !state.root) return values;

    const name = field.name || "value";
    const input = state.root.querySelector(`[name="${cssEscape(name)}"]`);
    values[name] = input ? input.value : "";
    return values;
  }

  function closeActive(result) {
    const item = activeItem;
    if (!item || !state.root) return;

    if (state.keydownHandler) {
      document.removeEventListener("keydown", state.keydownHandler);
      state.keydownHandler = null;
    }

    const root = state.root;
    root.classList.remove("is-visible");

    window.setTimeout(() => {
      root.innerHTML = "";
      root.classList.remove("is-active");
      document.body.classList.remove("fm-modal-open");

      const resolver = item.resolve;
      activeItem = null;
      resolver(result || { action: "close", value: false, values: {} });

      if (
        lastFocusedElement &&
        typeof lastFocusedElement.focus === "function"
      ) {
        try {
          lastFocusedElement.focus({ preventScroll: true });
        } catch (error) {
          // Focus restoration is best effort only.
        }
      }
      lastFocusedElement = null;
      pumpQueue();
    }, 180);
  }

  function closeById(id, result) {
    if (activeItem && activeItem.options.id === id) {
      closeActive(result || { action: "closed", value: false, values: {} });
      return true;
    }

    const index = queue.findIndex((item) => item.options.id === id);
    if (index >= 0) {
      const [item] = queue.splice(index, 1);
      item.resolve(result || { action: "closed", value: false, values: {} });
      return true;
    }

    return false;
  }

  function closeAll() {
    if (activeItem)
      closeActive({ action: "closed-all", value: false, values: {} });
    while (queue.length) {
      const item = queue.shift();
      item.resolve({ action: "closed-all", value: false, values: {} });
    }
  }

  function alertModal(message, options) {
    return show(
      normalizeOptions(message, {
        ...(options || {}),
        type: options?.type || "info",
      }),
    );
  }

  function confirmModal(message, options) {
    const config = normalizeOptions(message, {
      ...(options || {}),
      type: options?.type || "confirm",
      confirm: true,
      priority: options?.priority ?? 40,
    });
    return show(config).then(
      (result) => result.value === true || result.action === "confirm",
    );
  }

  function promptTextarea(options) {
    const fieldName = options?.name || "value";
    return show({
      type: options?.type || "admin",
      title: options?.title || "Informe os dados",
      message: options?.message || "",
      priority: options?.priority ?? 50,
      closeOnBackdrop: options?.closeOnBackdrop,
      closeOnEsc: options?.closeOnEsc,
      textarea: {
        name: fieldName,
        label: options?.label || "Mensagem",
        placeholder: options?.placeholder || "",
        value: options?.value || "",
        required: options?.required !== false,
        requiredMessage: options?.requiredMessage,
        rows: options?.rows || 4,
      },
      actions: [
        {
          id: "cancel",
          label: options?.cancelLabel || "Cancelar",
          value: false,
          variant: "ghost",
        },
        {
          id: "confirm",
          label: options?.confirmLabel || "Confirmar",
          value: true,
          variant: options?.danger ? "danger" : "primary",
        },
      ],
    }).then((result) => ({
      confirmed: result.action === "confirm",
      value: result.values?.[fieldName] || "",
      result,
    }));
  }

  function loading(message, options) {
    const config = normalizeOptions(message, {
      ...(options || {}),
      type: "loading",
      priority: options?.priority ?? 90,
      closeOnBackdrop: false,
      closeOnEsc: false,
      closeButton: false,
    });
    config.id = config.id || `fm_loading_${Date.now()}_${sequence++}`;
    const promise = show(config);

    return {
      id: config.id,
      promise,
      close(result) {
        closeById(
          config.id,
          result || { action: "done", value: true, values: {} },
        );
      },
      update(nextOptions) {
        if (activeItem && activeItem.options.id === config.id) {
          activeItem.options = {
            ...activeItem.options,
            ...(nextOptions || {}),
          };
          renderActiveItem();
          return;
        }
        const queued = queue.find((item) => item.options.id === config.id);
        if (queued)
          queued.options = { ...queued.options, ...(nextOptions || {}) };
      },
    };
  }

  function notify(message, options) {
    const config = normalizeOptions(message, options || {});
    const type = normalizeType(config.type || "system");
    const meta = metaFor(type);
    ensureRoot();
    if (!state.notificationStack) return null;

    const toast = document.createElement("div");
    toast.className = "fm-toast";
    toast.style.setProperty("--fm-toast-accent", config.accent || meta.accent);
    toast.innerHTML = `
            <div class="fm-modal-icon" style="width:28px;height:28px;font-size:.78rem;--fm-modal-accent:${config.accent || meta.accent};">${escapeHtml(config.icon || meta.icon)}</div>
            <div>
                <strong>${escapeHtml(config.title || meta.title)}</strong>
                <span>${escapeHtml(config.message || message || "")}</span>
            </div>
            <button class="fm-toast-close" type="button" aria-label="Fechar">×</button>
        `;

    const remove = () => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    };

    toast.querySelector(".fm-toast-close").addEventListener("click", remove);
    state.notificationStack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(remove, config.duration || 4500);
    return toast;
  }

  function fromRealtime(options) {
    return notify(options?.message || "Dados atualizados em tempo real.", {
      ...(options || {}),
      type: options?.type || "realtime",
      title: options?.title || "Sincronizado",
    });
  }

  const api = {
    show,
    alert: alertModal,
    info: (message, options) =>
      alertModal(message, { ...(options || {}), type: "info" }),
    warning: (message, options) =>
      alertModal(message, { ...(options || {}), type: "warning" }),
    error: (message, options) =>
      alertModal(message, {
        ...(options || {}),
        type: "error",
        priority: options?.priority ?? 60,
      }),
    success: (message, options) =>
      alertModal(message, {
        ...(options || {}),
        type: "success",
        priority: options?.priority ?? 30,
      }),
    admin: (message, options) =>
      alertModal(message, {
        ...(options || {}),
        type: "admin",
        priority: options?.priority ?? 50,
      }),
    system: (message, options) =>
      alertModal(message, { ...(options || {}), type: "system" }),
    voteOpen: (message, options) =>
      alertModal(message, {
        ...(options || {}),
        type: "vote",
        priority: options?.priority ?? 55,
      }),
    drawConfirm: (message, options) =>
      alertModal(message, {
        ...(options || {}),
        type: "draw",
        priority: options?.priority ?? 55,
      }),
    confirm: confirmModal,
    promptTextarea,
    loading,
    notify,
    fromRealtime,
    closeById,
    closeAll,
    nativeAlert,
    nativeConfirm,
    nativePrompt,
  };

  window.FMModal = api;
  window.fmAlert = api.alert;
  window.fmConfirm = api.confirm;

  window.alert = function (message) {
    api.alert(String(message ?? ""), { type: "info" });
  };

  window.confirm = function (message) {
    api.confirm(String(message ?? ""), { type: "confirm" });
    return false;
  };

  window.prompt = function (message, defaultValue) {
    api.promptTextarea({
      title: "Entrada necessaria",
      message: String(message ?? ""),
      value: String(defaultValue ?? ""),
      required: false,
    });
    return null;
  };

  api.checkPaymentStatus = async function() {
    if (typeof getCurrentStoredUser !== 'function' || typeof getPlayerPaymentStatus !== 'function') return;
    
    // Mostra apenas uma vez por sessão/login
    if (sessionStorage.getItem('paymentModalShown') === 'true') return;
    
    const currentUser = getCurrentStoredUser();
    if (!currentUser) return;
    
    try {
      const status = await getPlayerPaymentStatus(currentUser.auth_id || currentUser.id);
      if (status && status.confirmed === true && status.payment_status !== "paid") {
        
        sessionStorage.setItem('paymentModalShown', 'true');
        
        api.show({
          type: "warning",
          title: "Pagamento Pendente",
          message: "Você está confirmado para o jogo, mas ainda não realizou o pagamento da coleta.",
          closeOnEsc: true,
          closeOnBackdrop: true,
          closeButton: true,
          actions: [
            { id: "close", label: "Lembrar depois", variant: "secondary", closes: true },
            { id: "pay", label: "Ir para pagamento", variant: "primary", closes: false }
          ]
        }).then((result) => {
          if (result && result.action === "pay") {
            window.location.href = "payment.html";
          }
        });
      }
    } catch (e) {
      console.warn("Erro ao checar status de pagamento:", e);
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.FMModal && typeof window.FMModal.checkPaymentStatus === 'function') {
        window.FMModal.checkPaymentStatus();
      }
    }, 1500);
  });

  window.addEventListener("fm:realtime-modal", (event) => {
    api.fromRealtime(event.detail || {});
  });
})();
