async function getUserProfile(userId) {
  const client = getSupabaseClient();
  if (!client) return { role: 'user', username: null, full_name: null, phone: null };

  const { data, error } = await client
    .from("fm_profiles")
    .select("role, username, full_name, phone")
    .eq("auth_id", userId)
    .single();

  if (error || !data) {
      console.error("Erro ao buscar perfil:", error);
      return { role: 'user', username: null, full_name: null, phone: null };
  }
  return { role: data.role, username: data.username, full_name: data.full_name, phone: data.phone || null };
}

/**
 * Verifica se o usuário logado é visitante.
 */
function isVisitorUser() {
    const user = getCurrentUser();
    return user?.role === 'visitor';
}

/**
 * Lista de páginas que visitantes podem acessar.
 */
const VISITOR_ALLOWED_PAGES = [
    'welcome.html',
    'dashboard.html',
    'details.html',
    'placar-ao-vivo.html'
];

/**
 * Lista de páginas que exigem role admin.
 */
const ADMIN_ONLY_PAGES = [
    'admin-placar.html',
    'schedule.html',
    'financials.html'
];

async function checkAccess(requiredRole) {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data: { user }, error } = await client.auth.getUser();

  const isNestedPage = window.location.pathname.includes('/pages/');
  const loginPath = isNestedPage ? "../index.html" : "index.html";
  const welcomePath = isNestedPage ? "welcome.html" : "pages/welcome.html";

  if (!user || error) {
    window.location.href = loginPath;
    return null;
  }

  const profile = await getUserProfile(user.id);

  if (requiredRole && profile.role !== requiredRole) {
    // Se for visitante tentando acessar área admin, redireciona gentilmente
    if (profile.role === 'visitor') {
      await FMModal.admin({
        title: 'Acesso restrito',
        message: 'Esta área é exclusiva para jogadores cadastrados. Crie uma conta para ter acesso completo.',
        priority: 90
      });
    } else {
      await FMModal.admin({
        title: 'Acesso negado',
        message: 'Voce nao tem permissao para acessar esta area.',
        priority: 90
      });
    }
    window.location.href = welcomePath;
    return null;
  }

  // Verificar se visitante está em página permitida
  if (profile.role === 'visitor') {
    const currentPage = window.location.pathname.split('/').pop() || '';
    const isAllowed = VISITOR_ALLOWED_PAGES.some(p => currentPage.includes(p));
    
    if (!isAllowed) {
      await FMModal.admin({
        title: 'Acesso restrito',
        message: 'Visitantes não têm acesso a esta área. Cadastre-se para ter acesso completo.',
        priority: 90
      });
      window.location.href = welcomePath;
      return null;
    }
  }

  // Salvar dados completos do perfil no sessionStorage
  const currentUserData = {
    id: user.id,
    email: user.email,
    username: profile.username || user.user_metadata?.username || user.user_metadata?.name || 'Jogador',
    full_name: profile.full_name || user.user_metadata?.name || 'Jogador',
    phone: profile.phone || null,
    role: profile.role
  };
  sessionStorage.setItem('currentUser', JSON.stringify(currentUserData));
  return currentUserData;
}

function redirectToLogin() {
    const isNestedPage = window.location.pathname.includes('/pages/');
    window.location.href = isNestedPage ? '../index.html' : 'index.html';
}

function getCurrentUser() {
    try {
        return JSON.parse(sessionStorage.getItem('currentUser'));
    } catch (e) {
        return null;
    }
}

function isAdminUser() {
    return getCurrentUser()?.role === 'admin';
}

function clearCurrentUser() {
    sessionStorage.removeItem('currentUser');
}

// Backward compatibility functions
async function requireAuth() {
    return await checkAccess();
}

async function requireAdmin() {
    return await checkAccess('admin');
}

if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', async () => {
        // Ensure DB is initialized so getSupabaseClient() works
        if (typeof initDB === 'function') {
            await initDB();
        }
        
        // Se for a página de login/registro, não obriga auth
        if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('register.html') || window.location.pathname === '/' || window.location.pathname.endsWith('Futebol%20Milh%C3%A3o/')) {
            return;
        }

        const currentUser = await checkAccess();
        if (!currentUser) return;

        // Esconder elementos admin-only
        document.querySelectorAll('[data-admin-only]').forEach((element) => {
            element.style.display = currentUser.role === 'admin' ? '' : 'none';
        });

        // Esconder elementos que visitantes não podem ver
        document.querySelectorAll('[data-no-visitor]').forEach((element) => {
            element.style.display = currentUser.role === 'visitor' ? 'none' : '';
        });

        // Adicionar badge de visitante no header se aplicável
        if (currentUser.role === 'visitor') {
            document.body.classList.add('is-visitor');
            const header = document.querySelector('.main-header');
            if (header && !header.querySelector('.visitor-badge-header')) {
                const badge = document.createElement('div');
                badge.className = 'visitor-badge-header';
                badge.innerHTML = '<span>👁️ Visitante</span>';
                badge.style.cssText = 'position:fixed;top:8px;right:60px;z-index:999;background:rgba(245,158,11,0.15);color:#fbbf24;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:700;border:1px solid rgba(245,158,11,0.3);backdrop-filter:blur(8px);';
                document.body.appendChild(badge);
            }
        }
    });
}
