document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const fullNameInput = document.getElementById('new-fullname');
    const usernameInput = document.getElementById('new-username');
    const emailInput = document.getElementById('new-email');
    const phoneInput = document.getElementById('new-phone');
    const passwordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const errorMessageDiv = document.getElementById('register-error-message');
    const submitBtn = document.getElementById('register-btn');
    const reqLength = document.getElementById('req-length');
    const reqMatch = document.getElementById('req-match');

    if (!registerForm || !fullNameInput || !usernameInput || !emailInput || !passwordInput || !confirmPasswordInput) {
        return;
    }

    if (typeof initDB === 'function') {
        initDB().catch(console.warn);
    }

    // Validação Dinâmica da Senha
    function validatePassword() {
        const pass = passwordInput.value;
        const conf = confirmPasswordInput.value;
        
        const isLongEnough = pass.length >= 6;
        const isMatch = pass === conf && pass.length > 0;

        // Atualizar UI de requisitos
        if (isLongEnough) {
            reqLength.classList.add('valid');
        } else {
            reqLength.classList.remove('valid');
        }

        if (isMatch) {
            reqMatch.classList.add('valid');
        } else {
            reqMatch.classList.remove('valid');
        }

        // Habilitar botão apenas se tudo estiver ok
        submitBtn.disabled = !(isLongEnough && isMatch && fullNameInput.value && usernameInput.value && emailInput.value);
    }

    // Escutar eventos de digitação
    const inputsToWatch = [passwordInput, confirmPasswordInput, fullNameInput, usernameInput, emailInput];
    inputsToWatch.forEach(input => {
        input.addEventListener('input', validatePassword);
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        // Reset state
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
        submitBtn.disabled = true;
        const spanText = submitBtn.querySelector('span');
        const originalText = spanText.textContent;
        spanText.textContent = 'Criando Conta...';

        const fullName = fullNameInput.value.trim();
        const username = usernameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const phone = phoneInput ? phoneInput.value.trim().replace(/\D/g, '') : '';
        const password = passwordInput.value;

        try {
            const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : window.supabaseClient;
            if (!client) {
                throw new Error('Erro de conexão com o banco de dados. Recarregue a página.');
            }

            // Realizar Cadastro via Supabase Auth
            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name: fullName,
                        username: username,
                        phone: phone || null
                    }
                }
            });

            if (error) {
                console.error("Signup error:", error);
                
                // Mensagens amigáveis
                let errorMsg = 'Erro ao cadastrar. Tente novamente.';
                if (error.message.includes('already registered') || error.message.includes('User already exists')) {
                    errorMsg = 'Este e-mail já está cadastrado. Faça o login!';
                } else if (error.message.includes('Password should be')) {
                    errorMsg = 'A senha é muito fraca.';
                }
                
                throw new Error(errorMsg);
            }

            // Salvar telefone no perfil (se informado)
            if (phone && data.user?.id) {
                await client
                    .from('fm_profiles')
                    .update({ phone: phone })
                    .eq('auth_id', data.user.id);
            }

            const newUser = {
                id: data.user?.id,
                username: username,
                email: email,
                full_name: fullName,
                phone: phone || null,
                role: 'user'
            };

            // Salvar no fallback session
            sessionStorage.setItem('currentUser', JSON.stringify(newUser));
            
            // Sucesso visual
            errorMessageDiv.className = 'success-message';
            errorMessageDiv.textContent = 'Cadastro concluído! Direcionando para o jogo...';
            errorMessageDiv.style.display = 'block';

            setTimeout(() => {
                window.location.href = 'welcome.html';
            }, 1500);

        } catch (error) {
            console.error('Erro durante o cadastro:', error);
            errorMessageDiv.className = 'error-message';
            errorMessageDiv.textContent = error.message || 'Ocorreu um erro ao tentar criar a conta.';
            errorMessageDiv.style.display = 'block';
            submitBtn.disabled = false;
            spanText.textContent = originalText;
        }
    });
});
