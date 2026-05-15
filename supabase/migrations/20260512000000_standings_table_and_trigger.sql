-- ============================================================================
-- MIGRATION: Tabela de Classificação por Competição (Standings)
-- Data: 2026-05-12
-- Objetivo: Cada competição (match_id) tem sua própria tabela de classificação
--          independente. Atualizada automaticamente ao finalizar cada partida
--          via trigger no banco de dados.
-- ============================================================================

-- 1. Criar tabela de classificação
CREATE TABLE IF NOT EXISTS public.fm_standings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    match_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_color TEXT DEFAULT '#60a5fa',
    points INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    goals_for INTEGER NOT NULL DEFAULT 0,
    goals_against INTEGER NOT NULL DEFAULT 0,
    goal_difference INTEGER NOT NULL DEFAULT 0,
    matches_played INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(match_id, team_id)
);

-- 2. Índices para performance
CREATE INDEX IF NOT EXISTS idx_fm_standings_match_id ON public.fm_standings(match_id);
CREATE INDEX IF NOT EXISTS idx_fm_standings_match_points ON public.fm_standings(match_id, points DESC, wins DESC, goal_difference DESC, goals_for DESC, goals_against ASC);

-- 3. Habilitar RLS
ALTER TABLE public.fm_standings ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS: leitura pública, escrita apenas admin
CREATE POLICY "Standings são visíveis publicamente"
    ON public.fm_standings FOR SELECT
    USING (true);

CREATE POLICY "Apenas admins podem modificar standings"
    ON public.fm_standings FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.fm_profiles
            WHERE auth_id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.fm_profiles
            WHERE auth_id = auth.uid() AND role = 'admin'
        )
    );

-- 5. Comentários
COMMENT ON TABLE public.fm_standings IS 'Tabela de classificação por competição. Cada match_id tem sua própria tabela independente.';
COMMENT ON COLUMN public.fm_standings.match_id IS 'ID da competição em fm_matches. Cada competição tem sua própria tabela.';
COMMENT ON COLUMN public.fm_standings.team_id IS 'Identificador único do time dentro da competição.';
COMMENT ON COLUMN public.fm_standings.team_name IS 'Nome do time.';
COMMENT ON COLUMN public.fm_standings.team_color IS 'Cor do time para exibição visual.';
COMMENT ON COLUMN public.fm_standings.points IS 'Pontos: 3 por vitória, 1 por empate, 0 por derrota.';
COMMENT ON COLUMN public.fm_standings.goal_difference IS 'Saldo de gols (gols marcados - gols sofridos).';

-- ============================================================================
-- 6. Função de atualização automática da classificação
-- Disparada por trigger sempre que uma partida é finalizada
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_standings_on_match_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_match_id TEXT;
    v_team1_id TEXT;
    v_team2_id TEXT;
    v_team1_name TEXT;
    v_team2_name TEXT;
    v_team1_color TEXT;
    v_team2_color TEXT;
    v_team1_gols INTEGER;
    v_team2_gols INTEGER;
    v_team1_points INTEGER;
    v_team2_points INTEGER;
    v_team1_wins INTEGER;
    v_team2_wins INTEGER;
    v_team1_draws INTEGER;
    v_team2_draws INTEGER;
    v_team1_losses INTEGER;
    v_team2_losses INTEGER;
BEGIN
    -- Só processa quando o status muda para 'finalizada'
    IF NEW.status <> 'finalizada' OR OLD.status = 'finalizada' THEN
        RETURN NEW;
    END IF;

    -- Usa o match_id vinculado. Se não tiver, usa o próprio id da partida ao vivo
    -- como identificador único da "competição"
    v_match_id := COALESCE(NEW.match_id, NEW.id::TEXT);

    -- Dados do time 1
    v_team1_name := NEW.time1_nome;
    v_team1_color := COALESCE(NEW.time1_color, '#60a5fa');
    v_team1_gols := COALESCE(NEW.time1_gols, 0);
    v_team1_id := 'team_' || lower(regexp_replace(
        regexp_replace(v_team1_name, '[^a-zA-Z0-9]', '-', 'g'),
        '-+', '-', 'g'
    ));

    -- Dados do time 2
    v_team2_name := NEW.time2_nome;
    v_team2_color := COALESCE(NEW.time2_color, '#fb7185');
    v_team2_gols := COALESCE(NEW.time2_gols, 0);
    v_team2_id := 'team_' || lower(regexp_replace(
        regexp_replace(v_team2_name, '[^a-zA-Z0-9]', '-', 'g'),
        '-+', '-', 'g'
    ));

    -- Calcula resultados
    IF v_team1_gols > v_team2_gols THEN
        v_team1_points := 3; v_team2_points := 0;
        v_team1_wins := 1;   v_team2_wins := 0;
        v_team1_draws := 0;  v_team2_draws := 0;
        v_team1_losses := 0; v_team2_losses := 1;
    ELSIF v_team1_gols < v_team2_gols THEN
        v_team1_points := 0; v_team2_points := 3;
        v_team1_wins := 0;   v_team2_wins := 1;
        v_team1_draws := 0;  v_team2_draws := 0;
        v_team1_losses := 1; v_team2_losses := 0;
    ELSE
        v_team1_points := 1; v_team2_points := 1;
        v_team1_wins := 0;   v_team2_wins := 0;
        v_team1_draws := 1;  v_team2_draws := 1;
        v_team1_losses := 0; v_team2_losses := 0;
    END IF;

    -- UPSERT para Time 1
    INSERT INTO public.fm_standings (
        match_id, team_id, team_name, team_color,
        points, wins, draws, losses,
        goals_for, goals_against, goal_difference, matches_played
    ) VALUES (
        v_match_id, v_team1_id, v_team1_name, v_team1_color,
        v_team1_points, v_team1_wins, v_team1_draws, v_team1_losses,
        v_team1_gols, v_team2_gols, v_team1_gols - v_team2_gols, 1
    )
    ON CONFLICT (match_id, team_id) DO UPDATE SET
        team_name = EXCLUDED.team_name,
        team_color = EXCLUDED.team_color,
        points = fm_standings.points + EXCLUDED.points,
        wins = fm_standings.wins + EXCLUDED.wins,
        draws = fm_standings.draws + EXCLUDED.draws,
        losses = fm_standings.losses + EXCLUDED.losses,
        goals_for = fm_standings.goals_for + EXCLUDED.goals_for,
        goals_against = fm_standings.goals_against + EXCLUDED.goals_against,
        goal_difference = fm_standings.goal_difference + (EXCLUDED.goals_for - EXCLUDED.goals_against),
        matches_played = fm_standings.matches_played + 1,
        updated_at = now();

    -- UPSERT para Time 2
    INSERT INTO public.fm_standings (
        match_id, team_id, team_name, team_color,
        points, wins, draws, losses,
        goals_for, goals_against, goal_difference, matches_played
    ) VALUES (
        v_match_id, v_team2_id, v_team2_name, v_team2_color,
        v_team2_points, v_team2_wins, v_team2_draws, v_team2_losses,
        v_team2_gols, v_team1_gols, v_team2_gols - v_team1_gols, 1
    )
    ON CONFLICT (match_id, team_id) DO UPDATE SET
        team_name = EXCLUDED.team_name,
        team_color = EXCLUDED.team_color,
        points = fm_standings.points + EXCLUDED.points,
        wins = fm_standings.wins + EXCLUDED.wins,
        draws = fm_standings.draws + EXCLUDED.draws,
        losses = fm_standings.losses + EXCLUDED.losses,
        goals_for = fm_standings.goals_for + EXCLUDED.goals_for,
        goals_against = fm_standings.goals_against + EXCLUDED.goals_against,
        goal_difference = fm_standings.goal_difference + (EXCLUDED.goals_for - EXCLUDED.goals_against),
        matches_played = fm_standings.matches_played + 1,
        updated_at = now();

    RETURN NEW;
END;
$$;

-- 7. Trigger que dispara a função quando uma partida é finalizada
DROP TRIGGER IF EXISTS trg_update_standings_on_finish ON public.fm_partidas_ao_vivo;
CREATE TRIGGER trg_update_standings_on_finish
    AFTER UPDATE ON public.fm_partidas_ao_vivo
    FOR EACH ROW
    EXECUTE FUNCTION public.update_standings_on_match_finish();
