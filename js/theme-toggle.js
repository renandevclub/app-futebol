// ===== THEME TOGGLE - FUTEBOL MILHÃO =====
// Alterna entre tema escuro (padrão) e claro
// Persiste a escolha no localStorage

(function () {
    const STORAGE_KEY = 'fm-theme';

    // Aplica o tema salvo IMEDIATAMENTE (antes do paint)
    function aplicarTemaSalvo() {
        const salvo = localStorage.getItem(STORAGE_KEY);
        if (salvo === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }

    // Roda antes do DOM carregar para evitar flash
    aplicarTemaSalvo();

    function isLight() {
        return document.documentElement.getAttribute('data-theme') === 'light';
    }

    function toggleTheme() {
        if (isLight()) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem(STORAGE_KEY, 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem(STORAGE_KEY, 'light');
        }
        atualizarBotoes();
    }

    function atualizarBotoes() {
        const light = isLight();
        document.querySelectorAll('.nav-theme-toggle').forEach(btn => {
            const icon = btn.querySelector('.nav-icon');
            const text = btn.querySelector('.nav-text');
            if (icon) icon.textContent = light ? '🌙' : '☀️';
            if (text) text.textContent = light ? 'Modo Escuro' : 'Modo Claro';
        });
    }

    // Injeta o botão no menu de navegação quando o DOM estiver pronto
    function injetarBotao() {
        const containers = document.querySelectorAll('.nav-buttons-container');

        // Páginas com menu de navegação
        containers.forEach(container => {
            if (container.querySelector('.nav-theme-toggle')) return;

            const btn = document.createElement('a');
            btn.href = '#';
            btn.className = 'nav-button nav-theme-toggle';
            btn.innerHTML = `
                <span class="nav-icon">${isLight() ? '🌙' : '☀️'}</span>
                <span class="nav-text">${isLight() ? 'Modo Escuro' : 'Modo Claro'}</span>
            `;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleTheme();
            });

            const logout = container.querySelector('.nav-logout');
            if (logout) {
                container.insertBefore(btn, logout);
            } else {
                container.appendChild(btn);
            }
        });

        // Páginas SEM menu: botão flutuante no canto
        if (containers.length === 0 && !document.querySelector('.fm-theme-fab')) {
            const fab = document.createElement('button');
            fab.className = 'fm-theme-fab nav-theme-toggle';
            fab.type = 'button';
            fab.title = isLight() ? 'Modo Escuro' : 'Modo Claro';
            fab.innerHTML = `<span class="nav-icon">${isLight() ? '🌙' : '☀️'}</span>`;
            fab.style.cssText = `
                position:fixed; bottom:16px; right:16px; z-index:9999;
                width:44px; height:44px; border-radius:50%;
                border:1px solid var(--border-medium);
                background:var(--bg-card); color:var(--text-main);
                display:flex; align-items:center; justify-content:center;
                cursor:pointer; font-size:1.2rem;
                box-shadow:var(--shadow-md);
                transition:transform 0.2s, box-shadow 0.2s;
            `;
            fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.1)'; });
            fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
            fab.addEventListener('click', toggleTheme);
            document.body.appendChild(fab);
        }
    }

    function atualizarFab() {
        const fab = document.querySelector('.fm-theme-fab');
        if (fab) {
            const icon = fab.querySelector('.nav-icon');
            if (icon) icon.textContent = isLight() ? '🌙' : '☀️';
            fab.title = isLight() ? 'Modo Escuro' : 'Modo Claro';
        }
    }

    // Atualiza todos os botões (menu + fab)
    function atualizarBotoesCompleto() {
        atualizarBotoes();
        atualizarFab();
    }

    // Patch toggleTheme to update fab too
    const _origToggle = toggleTheme;
    toggleTheme = function() {
        if (isLight()) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem(STORAGE_KEY, 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem(STORAGE_KEY, 'light');
        }
        atualizarBotoesCompleto();
    };

    // Executa quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injetarBotao);
    } else {
        injetarBotao();
    }

    // Expõe globalmente caso necessário
    window.FMTheme = { toggle: toggleTheme, isLight };
})();
