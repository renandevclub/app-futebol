-- ============================================================================
-- MIGRATION: Persistir cores e ícones fixos por posição de cadastro de time
-- Data: 2026-05-09
-- Objetivo: Atualizar as partidas existentes para armazenar metadata de time
-- baseada na posição de cadastro, garantindo consistência entre dispositivos.
-- ============================================================================

create or replace function app_private.get_team_style_by_position(p_position integer)
returns jsonb
language sql
immutable
as $$
select jsonb_build_object(
  'color',
  case p_position
    when 1 then '#ef4444'
    when 2 then '#3b82f6'
    when 3 then '#1c1c2e'
    when 4 then '#10b981'
    when 5 then '#f59e0b'
    when 6 then '#8b5cf6'
    when 7 then '#f97316'
    when 8 then '#06b6d4'
    when 9 then '#ec4899'
    else '#6b7280'
  end,
  'icon',
  case p_position
    when 1 then '⚽'
    when 2 then '🔵'
    when 3 then '⚫'
    when 4 then '🟢'
    when 5 then '⭐'
    when 6 then '🟣'
    when 7 then '🟠'
    when 8 then '🔷'
    when 9 then '💗'
    else '✨'
  end
);
$$;

update public.fm_matches
set teams = (
  select jsonb_agg(
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(team, '{}'::jsonb), '{position}', to_jsonb(pos), true),
        '{color}', to_jsonb((app_private.get_team_style_by_position(pos::integer)->>'color')), true
      ),
      '{icon}', to_jsonb((app_private.get_team_style_by_position(pos::integer)->>'icon')), true
    )
    order by pos
  )
  from jsonb_array_elements(coalesce(teams, '[]'::jsonb)) with ordinality as team(team,pos)
)
where teams is not null;
