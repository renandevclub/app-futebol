document.addEventListener('DOMContentLoaded', () => {
    const carousel = document.querySelector('.carousel-inner');
    if (carousel) {
        const items = carousel.querySelectorAll('.carousel-item');
        const totalItems = items.length;
        let currentIndex = 0;

        // Função para trocar o slide
        function showNextSlide() {
            // Calcula o próximo índice
            const nextIndex = (currentIndex + 1) % totalItems;
            
            // Move o carrossel para a esquerda
            carousel.style.transform = `translateX(-${nextIndex * 100}%)`;
            
            // Atualiza o índice atual
            currentIndex = nextIndex;
        }

        // Inicia a troca automática a cada 4 segundos (4000 milissegundos)
        setInterval(showNextSlide, 4000);
    }

    // Configura botão do WhatsApp com link dinâmico do banco de dados
    async function setupWhatsappButton() {
        const btnJoinWhatsapp = document.getElementById('btn-join-whatsapp');
        if (btnJoinWhatsapp) {
            try {
                const link = await getConfig('whatsapp_group_link');
                if (link) {
                    btnJoinWhatsapp.href = link;
                }
            } catch (error) {
                console.error("Erro ao carregar link do WhatsApp", error);
            }
        }
    }

    setupWhatsappButton();
});
