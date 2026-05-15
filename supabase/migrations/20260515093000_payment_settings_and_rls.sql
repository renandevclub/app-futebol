-- Adiciona colunas de pagamento no fm_profiles e cria tabela de configuração de pagamento
ALTER TABLE IF EXISTS fm_profiles
ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS fm_profiles
ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS settings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_link text NOT NULL
);

-- Habilita RLS para fm_profiles e permite acesso apenas ao próprio jogador ou admins
ALTER TABLE IF EXISTS fm_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "fm_profiles_select_own" ON fm_profiles
  FOR SELECT USING (auth.uid() = auth_id);

CREATE POLICY IF NOT EXISTS "fm_profiles_update_own" ON fm_profiles
  FOR UPDATE USING (auth.uid() = auth_id)
  WITH CHECK (auth.uid() = auth_id);

CREATE POLICY IF NOT EXISTS "fm_profiles_select_admin" ON fm_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fm_profiles
      WHERE auth_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY IF NOT EXISTS "fm_profiles_update_admin" ON fm_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM fm_profiles
      WHERE auth_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM fm_profiles
      WHERE auth_id = auth.uid() AND role = 'admin'
    )
  );

-- Habilita RLS para settings e torna a leitura pública para todos os usuários autenticados
ALTER TABLE IF EXISTS settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "settings_select_public" ON settings
  FOR SELECT USING (true);
