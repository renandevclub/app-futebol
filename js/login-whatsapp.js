document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const nameInput = document.getElementById('login-name');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const roleSelect = document.getElementById('login-role');
    const loginButton = document.getElementById('login-button');
    const errorMessageDiv = document.getElementById('error-message');
    const adminFields = document.querySelectorAll('.admin-login-fields');

    if (!loginForm || !nameInput || !emailInput || !passwordInput || !roleSelect || !loginButton || !errorMessageDiv) {
        return;
    }

    // Always show email and password fields since auth requires it
    adminFields.forEach((field) => {
        field.style.display = 'block';
    });
    emailInput.required = true;
    passwordInput.required = true;

    // Update labels to make sense for both
    document.querySelector('label[for="login-email"]').textContent = "E-mail";
    emailInput.placeholder = "seu@email.com";
    document.querySelector('label[for="login-password"]').textContent = "Senha";

    roleSelect.addEventListener('change', () => {
        const isAdmin = roleSelect.value === 'Administrador';
        loginButton.textContent = isAdmin ? 'Entrar como Administrador' : 'Entrar como Jogador';
    });

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorMessageDiv.textContent = '';
        errorMessageDiv.style.display = 'none';

        const name = nameInput.value.trim();
        const role = roleSelect.value;
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        if (!name || !email || !password) {
            errorMessageDiv.textContent = 'Por favor, preencha todos os campos.';
            errorMessageDiv.style.display = 'block';
            return;
        }

        try {
            const client = getSupabaseClient();
            if (!client) {
                errorMessageDiv.textContent = 'Supabase não carregou. Recarregue a página.';
                errorMessageDiv.style.display = 'block';
                return;
            }
            
            // Login with Supabase
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            
            if (error || !data.user) {
                console.error("Login erro:", error);
                errorMessageDiv.textContent = 'Credenciais inválidas.';
                errorMessageDiv.style.display = 'block';
                return;
            }

            // Fetch role
            const { data: profileData, error: profileError } = await client
                .from('fm_profiles')
                .select('role')
                .eq('auth_id', data.user.id)
                .single();
                
            let userRole = profileData ? profileData.role : 'user';

            if (role === 'Administrador' && userRole !== 'admin') {
                await client.auth.signOut();
                errorMessageDiv.textContent = 'Seu usuário não possui acesso de administrador.';
                errorMessageDiv.style.display = 'block';
                return;
            }

            // Store in session storage just as fallback for existing UI checks
            sessionStorage.setItem('currentUser', JSON.stringify({
                id: data.user.id,
                username: name,
                email: email,
                role: userRole
            }));

            window.location.href = 'pages/welcome.html';
        } catch (error) {
            console.error('Erro no login:', error);
            errorMessageDiv.textContent = error?.message || 'Não foi possível entrar. Tente novamente.';
            errorMessageDiv.style.display = 'block';
        }
    });
});

