document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMessageDiv = document.getElementById('error-message');
    const loginButton = loginForm ? loginForm.querySelector('button') : null;

    async function setupPage() {
        if (!loginForm || !loginButton || !errorMessageDiv) {
            console.error('Login form elements não encontrados.');
            return;
        }

        try {
            loginButton.disabled = true;
            loginButton.textContent = 'Carregando...';
            await initDB();
            await populateInitialData();
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) {
                throw sessionError;
            }
            if (session) {
                window.location.href = 'pages/welcome.html';
                return;
            }
            loginButton.disabled = false;
            loginButton.textContent = 'Entrar';
        } catch (error) {
            console.error('Falha grave ao inicializar a página:', error);
            errorMessageDiv.textContent = error?.message || 'Erro crítico ao carregar o app. Tente recarregar a página.';
            errorMessageDiv.style.display = 'block';
            loginButton.disabled = true;
        }
    }

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = usernameInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        errorMessageDiv.textContent = '';
        errorMessageDiv.style.display = 'none';

        if (!email || !password) {
            errorMessageDiv.textContent = 'Por favor, informe seu e-mail e senha.';
            errorMessageDiv.style.display = 'block';
            return;
        }

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error || !data.session) {
                console.error('Erro de login Supabase:', error);
                errorMessageDiv.textContent = 'Credenciais inválidas ou conta não confirmada.';
                errorMessageDiv.style.display = 'block';
                return;
            }

            const profile = await getUserByEmail(email);
            if (!profile) {
                errorMessageDiv.textContent = 'Usuário não encontrado no perfil. Tente novamente.';
                errorMessageDiv.style.display = 'block';
                return;
            }

            await addActivityLog({ username: profile.username, action: 'login' });
            sessionStorage.setItem('currentUser', JSON.stringify(profile));
            window.location.href = 'pages/welcome.html';
        } catch (error) {
            console.error('Erro durante o login:', error);
            errorMessageDiv.textContent = 'Ocorreu um erro. Tente novamente.';
            errorMessageDiv.style.display = 'block';
        }
    });

    setupPage();
});
