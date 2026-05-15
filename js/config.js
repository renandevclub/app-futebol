/**
 * ============================================
 * Futebol Milhão - Configuração Centralizada
 * ============================================
 * 
 * ATENÇÃO: Este arquivo contém a chave ANON/PUBLISHABLE do Supabase.
 * Esta chave é projetada para ser pública no frontend.
 * As permissões de acesso aos dados são controladas via
 * Row Level Security (RLS) no banco de dados.
 * 
 * Dados sensíveis como telefone e link de WhatsApp
 * são armazenados na tabela fm_app_config do Supabase.
 * Os valores abaixo são APENAS fallbacks.
 * ============================================
 */

const FM_CONFIG = {
  // Supabase - Chave pública (anon key). Segura para frontend.
  supabase: {
    url: 'https://yepleajrpynexloacxcg.supabase.co',
    publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllcGxlYWpycHluZXhsb2FjeGNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MzYyODQsImV4cCI6MjA5MzMxMjI4NH0.3Ky5IO-3W9uhm4B8wid_iwwAXZpxd9wepCtd_yxIdJI'
  },

  // Valores padrão (fallback) - os valores reais vêm do banco (fm_app_config)
  defaults: {
    adminWhatsapp: '',    // Será carregado do banco
    whatsappGroupLink: '' // Será carregado do banco
  }
};

// Expor globalmente para manter compatibilidade
window.FM_CONFIG = FM_CONFIG;
