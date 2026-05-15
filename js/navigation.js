document.addEventListener('DOMContentLoaded', () => {
    const navs = document.querySelectorAll('.main-nav');
    const currentPage = window.location.pathname.split('/').pop() || 'welcome.html';

    navs.forEach((nav) => {
        const toggle = nav.querySelector('.nav-toggle');
        const menu   = nav.querySelector('.nav-buttons-container');
        if (!toggle || !menu) return;

        // ----- Overlay (criado 1x no body, fora do header) -----
        let overlay = document.querySelector('.nav-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'nav-overlay';
            document.body.appendChild(overlay);
        }

        // ----- Detectar página ativa e destacar no menu -----
        menu.querySelectorAll('.nav-button').forEach(btn => {
            const href = btn.getAttribute('href');
            if (!href) return;
            const linkPage = href.split('/').pop();
            if (linkPage === currentPage) {
                btn.classList.add('active');
            }
        });

        // ----- Abrir / Fechar -----
        function openMenu() {
            nav.classList.add('is-open');
            toggle.setAttribute('aria-expanded', 'true');
            overlay.classList.add('is-active');
            document.body.style.overflow = 'hidden';
        }

        function closeMenu() {
            nav.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
            overlay.classList.remove('is-active');
            document.body.style.overflow = '';
        }

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            nav.classList.contains('is-open') ? closeMenu() : openMenu();
        });

        // Fechar ao clicar no overlay
        overlay.addEventListener('click', closeMenu);

        // Fechar ao clicar num link (mobile)
        menu.querySelectorAll('a, button').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 900) closeMenu();
            });
        });

        // ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && nav.classList.contains('is-open')) closeMenu();
        });

        // ----- WhatsApp Dinâmico (Admin) -----
        async function setupAdminWhatsapp() {
            const waButton = nav.querySelector('.nav-whatsapp');
            if (waButton) {
                try {
                    // Texto solicitado pelo usuário: "WhatsApp Admin"
                    const textSpan = waButton.querySelector('.nav-text');
                    if (textSpan) textSpan.textContent = 'WhatsApp Admin';
                    
                    // Busca link no banco via getConfig (função global de database.js)
                    if (typeof getConfig === 'function') {
                        const link = await getConfig('admin_whatsapp_url');
                        if (link) {
                            waButton.href = link;
                        }
                    }
                } catch (err) {
                    console.warn("Erro ao configurar link do WhatsApp Admin:", err);
                }
            }
        }
        setupAdminWhatsapp();
    });
});
