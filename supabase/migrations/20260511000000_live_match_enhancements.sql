-- ============================================================================
-- MIGRATION: Melhorias no Placar Ao Vivo - Vínculo com Partidas Cadastradas
-- Data: 2026-05-11
-- Objetivo: Vincular fm_partidas_ao_vivo com fm_matches, adicionar campos
--          de escalação, substituições, eventos personalizados e observações.
-- ============================================================================

-- 1. Adicionar coluna match_id para vincular à partida cadastrada
alter table public.fm_partidas_ao_vivo
    add column if not exists match_id text;

-- 2. Adicionar coluna de período (1T, 2T, PR)
alter table public.fm_partidas_ao_vivo
    add column if not exists periodo text not null default '1T';

-- 3. Adicionar coluna de escalação (jogadores por time)
alter table public.fm_partidas_ao_vivo
    add column if not exists escalacao jsonb not null default '{"time1":[],"time2":[]}'::jsonb;

-- 4. Adicionar coluna de substituições
alter table public.fm_partidas_ao_vivo
    add column if not exists substituicoes jsonb not null default '[]'::jsonb;

-- 5. Adicionar coluna de eventos personalizados
alter table public.fm_partidas_ao_vivo
    add column if not exists eventos_personalizados jsonb not null default '[]'::jsonb;

-- 6. Adicionar coluna de observações do administrador
alter table public.fm_partidas_ao_vivo
    add column if not exists observacoes text not null default '';

-- 7. Adicionar coluna de cartões amarelos (separado dos vermelhos)
alter table public.fm_partidas_ao_vivo
    add column if not exists cartoes_amarelos_registrados jsonb not null default '{"time1":[],"time2":[]}'::jsonb;

-- 8. Adicionar índices para performance
create index if not exists idx_fm_partidas_ao_vivo_match_id
    on public.fm_partidas_ao_vivo(match_id);

create index if not exists idx_fm_partidas_ao_vivo_status
    on public.fm_partidas_ao_vivo(status);

-- 9. Comentários nas colunas
comment on column public.fm_partidas_ao_vivo.match_id is
    'ID da partida em fm_matches. Quando vinculado, carrega automaticamente times, jogadores e escalação.';

comment on column public.fm_partidas_ao_vivo.periodo is
    'Período atual da partida: 1T, 2T ou PR (prorrogação).';

comment on column public.fm_partidas_ao_vivo.escalacao is
    'Jogadores escalados por time: { time1: [{nome, numero, posicao}], time2: [...] }.';

comment on column public.fm_partidas_ao_vivo.substituicoes is
    'Histórico de substituições: [{minuto, time, sai, entra}].';

comment on column public.fm_partidas_ao_vivo.eventos_personalizados is
    'Eventos manuais: [{minuto, descricao, icone}].';

comment on column public.fm_partidas_ao_vivo.observacoes is
    'Anotações livres do administrador da partida.';

comment on column public.fm_partidas_ao_vivo.cartoes_amarelos_registrados is
    'Cartões amarelos: { time1: [{jogador, minuto}], time2: [...] }.';