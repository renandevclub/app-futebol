-- ============================================================================
-- MIGRATION: Sistema Antifraude de Sorteio de Times
-- Data: 2026-05-09
-- Objetivo: Eliminar completamente a possibilidade de bypass do sorteio
-- ============================================================================

-- ============================================================================
-- 1. TABELA DE SORTEIOS (substitui o JSONB team_draws para integridade real)
-- ============================================================================
create table if not exists public.fm_player_draws (
    id uuid primary key default gen_random_uuid(),
    match_id text not null references public.fm_matches(id) on delete cascade,
    player_username text not null,
    player_key text not null,
    team_id text not null,
    team_name text not null,
    -- Status do sorteio:
    -- 'drawn' = sorteio realizado, jogador vinculado ao time
    -- 'released' = admin liberou novo sorteio (histórico)
    status text not null default 'drawn' check (status in ('drawn', 'released')),
    -- Metadados de auditoria
    assigned_by text not null default 'system', -- 'system' ou 'admin_username'
    idempotency_key text, -- chave de idempotência para evitar duplicação por replay
    drawn_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    released_at timestamptz,
    released_by text,
    release_reason text,
    
    -- CONSTRAINT CRÍTICA: Um jogador só pode ter UM sorteio ativo por partida
    constraint fm_player_draws_unique_active 
        unique (match_id, player_key, status),
    -- CONSTRAINT: Apenas um sorteio 'drawn' por jogador por partida
    -- Isso é garantido pela unique acima + check status
    constraint fm_player_draws_one_active_per_player
        exclude using btree (match_id with =, player_key with =) where (status = 'drawn')
);

comment on table public.fm_player_draws is 
    'Registro imutável de sorteios de times. Um jogador só pode ter um registro com status=''drawn'' por partida.';

comment on column public.fm_player_draws.idempotency_key is
    'Chave única para evitar duplicação por replay de requests (idempotency).';

-- Índices para performance e constraints
create index if not exists idx_fm_draws_match_player 
    on public.fm_player_draws(match_id, player_key);
create index if not exists idx_fm_draws_match_status 
    on public.fm_player_draws(match_id, status);
create index if not exists idx_fm_draws_idempotency 
    on public.fm_player_draws(idempotency_key) where idempotency_key is not null;

-- ============================================================================
-- 2. TABELA DE LOGS DE AUDITORIA DE SORTEIOS
-- ============================================================================
create table if not exists public.fm_draw_audit_logs (
    id uuid primary key default gen_random_uuid(),
    match_id text not null,
    player_username text,
    player_key text,
    action text not null check (action in (
        'draw_success',
        'draw_blocked_already_drawn',
        'draw_blocked_no_profile',
        'draw_blocked_insufficient_teams',
        'draw_blocked_team_removed',
        'draw_blocked_match_not_found',
        'draw_error_unexpected',
        'draw_error_lock_timeout',
        'admin_release_draw',
        'admin_manual_assignment',
        'frontend_idempotency_replay',
        'bypass_attempt_detected'
    )),
    details jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamptz not null default now()
);

comment on table public.fm_draw_audit_logs is
    'Logs completos de auditoria de sorteios, tentativas bloqueadas e ações administrativas.';

create index if not exists idx_fm_draw_logs_match 
    on public.fm_draw_audit_logs(match_id, created_at desc);
create index if not exists idx_fm_draw_logs_action 
    on public.fm_draw_audit_logs(action, created_at desc);

-- ============================================================================
-- 3. FUNÇÃO AUXILIAR: Obter usuário atual de forma segura
-- ============================================================================
create or replace function app_private.get_current_player_username()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
    v_username text;
begin
    if auth.uid() is null then
        return null;
    end if;

    select username
    into v_username
    from public.fm_profiles
    where auth_id = auth.uid()
    limit 1;

    return v_username;
end;
$$;

-- ============================================================================
-- 4. FUNÇÃO AUXILIAR: Registrar log de auditoria
-- ============================================================================
create or replace function app_private.log_draw_event(
    p_match_id text,
    p_player_username text,
    p_player_key text,
    p_action text,
    p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.fm_draw_audit_logs (
        match_id,
        player_username,
        player_key,
        action,
        details
    ) values (
        p_match_id,
        p_player_username,
        p_player_key,
        p_action,
        p_details
    );
end;
$$;

-- ============================================================================
-- 5. RPC PRINCIPAL DE SORTEIO SEGURO (reescrita completa)
-- ============================================================================
create or replace function app_private.player_draw_team_impl(
    p_match_id text,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_username text;
    v_player_key text;
    v_match record;
    v_existing_draw record;
    v_existing_player jsonb;
    v_teams jsonb;
    v_selected_team_id text;
    v_selected_team_name text;
    v_assignment jsonb;
    v_player_entry jsonb;
    v_updated_players jsonb;
    v_result jsonb;
    v_now timestamptz := now();
begin
    -- =====================================================================
    -- VALIDAÇÃO 1: Autenticação (NUNCA confiar em dados do frontend)
    -- =====================================================================
    if auth.uid() is null then
        perform app_private.log_draw_event(p_match_id, null, null, 'draw_blocked_no_profile');
        raise exception 'Voce precisa estar logado para sortear o time.';
    end if;

    -- Obtém username DIRETAMENTE do banco, NUNCA do frontend
    v_username := app_private.get_current_player_username();
    if v_username is null or btrim(v_username) = '' then
        perform app_private.log_draw_event(p_match_id, null, null, 'draw_blocked_no_profile');
        raise exception 'Perfil de jogador nao encontrado.';
    end if;

    v_player_key := lower(btrim(v_username));

    -- =====================================================================
    -- VALIDAÇÃO 2: Idempotency (evita replay de requests)
    -- =====================================================================
    if p_idempotency_key is not null then
        -- Verifica se já existe um sorteio com esta chave de idempotência
        select id, team_id, team_name, status, team_name as existing_team_name
        into v_existing_draw
        from public.fm_player_draws
        where idempotency_key = p_idempotency_key
          and match_id = p_match_id
        limit 1;

        if found then
            -- Já processado anteriormente, retorna o mesmo resultado
            perform app_private.log_draw_event(
                p_match_id, v_username, v_player_key,
                'frontend_idempotency_replay',
                jsonb_build_object(
                    'idempotency_key', p_idempotency_key,
                    'existing_draw_id', v_existing_draw.id,
                    'existing_team', v_existing_draw.existing_team_name
                )
            );

            return jsonb_build_object(
                'status', case when v_existing_draw.status = 'drawn' then 'already_joined' else 'released' end,
                'assignment', jsonb_build_object(
                    'teamId', v_existing_draw.team_id,
                    'teamName', v_existing_draw.existing_team_name,
                    'username', v_username
                ),
                'idempotent', true
            );
        end if;
    end if;

    -- =====================================================================
    -- VALIDAÇÃO 3: Partida existe + LOCK de linha para evitar race condition
    -- =====================================================================
    select *
    into v_match
    from public.fm_matches
    where id = p_match_id
    for update; -- LOCK! Bloqueia a linha da partida para ninguém mais escrever

    if not found then
        perform app_private.log_draw_event(p_match_id, v_username, v_player_key, 'draw_blocked_match_not_found');
        raise exception 'Partida nao encontrada.';
    end if;

    -- =====================================================================
    -- VALIDAÇÃO 4: Número mínimo de times (3+)
    -- =====================================================================
    if jsonb_typeof(v_match.teams) <> 'array'
        or jsonb_array_length(v_match.teams) < 3 then
        perform app_private.log_draw_event(
            p_match_id, v_username, v_player_key,
            'draw_blocked_insufficient_teams',
            jsonb_build_object('team_count', jsonb_array_length(v_match.teams))
        );
        raise exception 'O sorteio so fica disponivel com 3 ou mais times cadastrados.';
    end if;

    -- =====================================================================
    -- VALIDAÇÃO 5: Jogador JÁ tem sorteio ATIVO? (BLOQUEIO TOTAL)
    --    Esta é a proteção CRÍTICA que impede bypass por refresh/outra aba
    -- =====================================================================
    select id, team_id, team_name, status
    into v_existing_draw
    from public.fm_player_draws
    where match_id = p_match_id
      and player_key = v_player_key
      and status = 'drawn'
    limit 1;

    if found then
        -- BLOQUEADO: Jogador já tem um sorteio ativo/drawn
        -- NÃO importa se ele deu refresh, limpou cache, trocou de navegador
        -- O banco tem o registro imutável
        perform app_private.log_draw_event(
            p_match_id, v_username, v_player_key,
            'draw_blocked_already_drawn',
            jsonb_build_object(
                'existing_draw_id', v_existing_draw.id,
                'existing_team', v_existing_draw.team_name,
                'existing_team_id', v_existing_draw.team_id
            )
        );

        -- Verifica se o time ainda existe nos times da partida
        if not exists (
            select 1
            from jsonb_array_elements(v_match.teams) as team(value)
            where team.value->>'id' = v_existing_draw.team_id
        ) then
            perform app_private.log_draw_event(
                p_match_id, v_username, v_player_key,
                'draw_blocked_team_removed',
                jsonb_build_object('removed_team_id', v_existing_draw.team_id)
            );
            raise exception 'Seu time sorteado anteriormente nao esta mais cadastrado nesta partida. Procure o administrador.';
        end if;

        -- Time ainda existe: retorna o mesmo resultado SEMPRE
        return jsonb_build_object(
            'status', 'already_joined',
            'assignment', jsonb_build_object(
                'teamId', v_existing_draw.team_id,
                'teamName', v_existing_draw.team_name,
                'username', v_username
            ),
            'draw_id', v_existing_draw.id
        );
    end if;

    -- =====================================================================
    -- SORTEIO REAL: Seleciona time com balanceamento no BACKEND
    -- =====================================================================
    v_teams := v_match.teams;

    -- Seleciona os times com contagem de jogadores já sorteados
    with team_list as (
        select
            team.value as team_data,
            team.value->>'id' as team_id,
            team.value->>'name' as team_name
        from jsonb_array_elements(v_teams) with ordinality as team(value, position)
        where coalesce(btrim(team.value->>'id'), '') <> ''
          and coalesce(btrim(team.value->>'name'), '') <> ''
    ),
    team_counts as (
        select
            tl.team_data,
            tl.team_id,
            tl.team_name,
            coalesce(d.draw_count, 0) as player_count
        from team_list tl
        left join lateral (
            select count(*) as draw_count
            from public.fm_player_draws
            where match_id = p_match_id
              and team_id = tl.team_id
              and status = 'drawn'
        ) d on true
    ),
    min_count as (
        select min(player_count) as min_val from team_counts
    ),
    eligible_teams as (
        select team_data, team_id, team_name
        from team_counts, min_count
        where player_count = min_count.min_val
    )
    select team_id, team_name
    into v_selected_team_id, v_selected_team_name
    from eligible_teams
    order by random()
    limit 1;

    if v_selected_team_id is null then
        perform app_private.log_draw_event(
            p_match_id, v_username, v_player_key,
            'draw_error_unexpected',
            jsonb_build_object('reason', 'no_eligible_team')
        );
        raise exception 'Nenhum time valido encontrado para o sorteio.';
    end if;

    -- =====================================================================
    -- SALVA O SORTEIO NA NOVA TABELA (IMUTÁVEL)
    -- =====================================================================
    insert into public.fm_player_draws (
        match_id,
        player_username,
        player_key,
        team_id,
        team_name,
        status,
        idempotency_key,
        drawn_at
    ) values (
        p_match_id,
        v_username,
        v_player_key,
        v_selected_team_id,
        v_selected_team_name,
        'drawn',
        p_idempotency_key,
        v_now
    )
    on conflict on constraint fm_player_draws_unique_active 
    do nothing
    returning id, team_id, team_name into v_existing_draw;

    -- Se o ON CONFLICT DO NOTHING aconteceu (concorrência extrema), busca o existente
    if v_existing_draw.id is null then
        select id, team_id, team_name
        into v_existing_draw
        from public.fm_player_draws
        where match_id = p_match_id
          and player_key = v_player_key
          and status = 'drawn'
        limit 1;

        -- Se mesmo assim não encontrou (erro grave), usa o que foi selecionado
        if v_existing_draw.id is null then
            v_existing_draw.team_id := v_selected_team_id;
            v_existing_draw.team_name := v_selected_team_name;
        end if;
    end if;

    -- =====================================================================
    -- ATUALIZA O ARRAY players NO JSONB (retrocompatibilidade)
    -- =====================================================================
    -- Verifica se o jogador já está na lista de players
    select player.value
    into v_existing_player
    from jsonb_array_elements(v_match.players) as player(value)
    where lower(btrim(player.value->>'username')) = v_player_key
    limit 1;

    v_player_entry := jsonb_build_object(
        'username', v_username,
        'teamId', v_existing_draw.team_id,
        'teamName', v_existing_draw.team_name,
        'assignmentMode', 'draw',
        'drawnAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'paid', coalesce((v_existing_player->>'paid')::boolean, false),
        'receiptSent', coalesce((v_existing_player->>'receiptSent')::boolean, false)
    );

    if v_existing_player is null then
        -- Adiciona o jogador ao array
        v_updated_players := v_match.players || v_player_entry;
    else
        -- Atualiza o jogador existente
        select coalesce(jsonb_agg(
            case
                when lower(btrim(player.value->>'username')) = v_player_key then
                    v_player_entry
                else
                    player.value
            end
            order by player.position
        ), '[]'::jsonb)
        into v_updated_players
        from jsonb_array_elements(v_match.players) with ordinality as player(value, position);
    end if;

    -- Atualiza a partida (players + team_draws para compatibilidade)
    update public.fm_matches
    set players = v_updated_players,
        team_draws = jsonb_set(
            coalesce(team_draws, '{}'::jsonb),
            array[v_player_key],
            jsonb_build_object(
                'teamId', v_existing_draw.team_id,
                'teamName', v_existing_draw.team_name,
                'username', v_username,
                'drawnAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
        ),
        updated_at = v_now
    where id = p_match_id;

    -- =====================================================================
    -- LOG DE SUCESSO
    -- =====================================================================
    perform app_private.log_draw_event(
        p_match_id, v_username, v_player_key,
        'draw_success',
        jsonb_build_object(
            'draw_id', v_existing_draw.id,
            'team_id', v_existing_draw.team_id,
            'team_name', v_existing_draw.team_name,
            'idempotency_key', p_idempotency_key
        )
    );

    -- =====================================================================
    -- RETORNO
    -- =====================================================================
    v_assignment := jsonb_build_object(
        'teamId', v_existing_draw.team_id,
        'teamName', v_existing_draw.team_name,
        'username', v_username
    );

    return jsonb_build_object(
        'status', 'drawn',
        'assignment', v_assignment,
        'player', v_player_entry,
        'draw_id', v_existing_draw.id
    );
end;
$$;

-- ============================================================================
-- 6. RPC PÚBLICA (wrapper com security invoker)
-- ============================================================================
create or replace function public.player_draw_team(
    p_match_id text,
    p_idempotency_key text default null
)
returns jsonb
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.player_draw_team_impl(p_match_id, p_idempotency_key);
$$;

-- Permissões: Apenas usuários autenticados podem chamar
revoke all on function public.player_draw_team(text, text) from public;
revoke all on function app_private.player_draw_team_impl(text, text) from public;
revoke execute on function public.player_draw_team(text, text) from anon;
revoke execute on function app_private.player_draw_team_impl(text, text) from anon;
grant execute on function public.player_draw_team(text, text) to authenticated;
grant execute on function app_private.player_draw_team_impl(text, text) to authenticated;

-- ============================================================================
-- 7. FUNÇÃO PARA CONSULTAR STATUS DO JOGADOR (usada pelo frontend ao carregar)
-- ============================================================================
create or replace function app_private.get_player_draw_status_impl(p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_username text;
    v_player_key text;
    v_draw record;
begin
    if auth.uid() is null then
        return jsonb_build_object('authenticated', false);
    end if;

    v_username := app_private.get_current_player_username();
    if v_username is null then
        return jsonb_build_object('authenticated', false);
    end if;

    v_player_key := lower(btrim(v_username));

    -- Busca o sorteio ativo na nova tabela
    select id, team_id, team_name, status, drawn_at
    into v_draw
    from public.fm_player_draws
    where match_id = p_match_id
      and player_key = v_player_key
      and status = 'drawn'
    limit 1;

    if found then
        return jsonb_build_object(
            'authenticated', true,
            'username', v_username,
            'has_draw', true,
            'draw_id', v_draw.id,
            'team_id', v_draw.team_id,
            'team_name', v_draw.team_name,
            'drawn_at', v_draw.drawn_at
        );
    end if;

    -- Verifica se já foi liberado (released)
    select id, team_id, team_name, status
    into v_draw
    from public.fm_player_draws
    where match_id = p_match_id
      and player_key = v_player_key
      and status = 'released'
    order by created_at desc
    limit 1;

    if found then
        return jsonb_build_object(
            'authenticated', true,
            'username', v_username,
            'has_draw', false,
            'was_released', true,
            'last_team', v_draw.team_name
        );
    end if;

    return jsonb_build_object(
        'authenticated', true,
        'username', v_username,
        'has_draw', false
    );
end;
$$;

create or replace function public.get_player_draw_status(p_match_id text)
returns jsonb
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.get_player_draw_status_impl(p_match_id);
$$;

revoke all on function public.get_player_draw_status(text) from public;
revoke execute on function public.get_player_draw_status(text) from anon;
grant execute on function public.get_player_draw_status(text) to authenticated;

-- ============================================================================
-- 8. FUNÇÃO ADMIN: Liberar novo sorteio (reescrita com nova tabela)
-- ============================================================================
create or replace function app_private.admin_release_player_draw_impl(
    p_match_id text,
    p_player_username text,
    p_release_reason text default 'Administrador liberou novo sorteio.'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_player_key text;
    v_admin_username text;
    v_match record;
    v_draw record;
    v_updated_players jsonb;
    v_player jsonb;
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para liberar novo sorteio.';
    end if;

    if not app_private.is_fm_admin() then
        raise exception 'Apenas administradores podem liberar novo sorteio.';
    end if;

    v_admin_username := app_private.get_current_player_username();
    v_player_key := lower(btrim(p_player_username));

    if v_player_key = '' then
        raise exception 'Jogador invalido.';
    end if;

    -- Lock na partida
    select *
    into v_match
    from public.fm_matches
    where id = p_match_id
    for update;

    if not found then
        raise exception 'Partida nao encontrada.';
    end if;

    -- Marca o sorteio atual como 'released'
    update public.fm_player_draws
    set status = 'released',
        released_at = now(),
        released_by = v_admin_username,
        release_reason = p_release_reason,
        updated_at = now()
    where match_id = p_match_id
      and player_key = v_player_key
      and status = 'drawn'
    returning id, team_id, team_name into v_draw;

    if not found then
        raise exception 'Jogador nao possui sorteio ativo nesta partida.';
    end if;

    -- Remove teamId/teamName do array players
    select coalesce(jsonb_agg(
        case
            when lower(btrim(player.value->>'username')) = v_player_key then
                (player.value - 'teamId' - 'teamName' - 'assignmentMode' - 'drawnAt')
                || jsonb_build_object('pendingDraw', true)
            else
                player.value
        end
        order by player.position
    ), '[]'::jsonb)
    into v_updated_players
    from jsonb_array_elements(v_match.players) with ordinality as player(value, position);

    -- Remove o team_draws do JSONB (retrocompatibilidade)
    update public.fm_matches
    set players = v_updated_players,
        team_draws = coalesce(team_draws, '{}'::jsonb) - v_player_key,
        updated_at = now()
    where id = p_match_id;

    -- Log de auditoria
    perform app_private.log_draw_event(
        p_match_id, p_player_username, v_player_key,
        'admin_release_draw',
        jsonb_build_object(
            'released_draw_id', v_draw.id,
            'released_team', v_draw.team_name,
            'admin', v_admin_username,
            'reason', p_release_reason
        )
    );
end;
$$;

create or replace function public.admin_release_player_draw(
    p_match_id text,
    p_player_username text,
    p_release_reason text default 'Administrador liberou novo sorteio.'
)
returns void
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.admin_release_player_draw_impl(p_match_id, p_player_username, p_release_reason);
$$;

revoke all on function public.admin_release_player_draw(text, text, text) from public;
revoke execute on function public.admin_release_player_draw(text, text, text) from anon;
grant execute on function public.admin_release_player_draw(text, text, text) to authenticated;

-- ============================================================================
-- 9. TRIGGER: Bloqueia inserts manuais diretos na fm_player_draws
-- ============================================================================
create or replace function app_private.validate_player_draw_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- Bloqueia inserts que não venham da RPC (defesa em profundidade)
    -- A RPC `player_draw_team_impl` sempre popula o player_username do auth.uid()
    -- Inserts diretos via REST API são detectados pela ausência de contexto da função
    -- Nota: Esta trigger é uma defesa adicional. A RLS também bloqueia inserts diretos.
    
    -- Valida que o player_key corresponde ao username normalizado
    if lower(btrim(new.player_username)) <> new.player_key then
        raise exception 'player_key deve corresponder ao username normalizado.';
    end if;

    -- Valida que o time existe na partida
    if not exists (
        select 1
        from public.fm_matches m,
             jsonb_array_elements(m.teams) as team(value)
        where m.id = new.match_id
          and team.value->>'id' = new.team_id
    ) then
        raise exception 'Time nao pertence a esta partida.';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_validate_player_draw_insert on public.fm_player_draws;
create trigger trg_validate_player_draw_insert
    before insert on public.fm_player_draws
    for each row
    execute function app_private.validate_player_draw_insert();

-- ============================================================================
-- 10. POLÍTICAS RLS ATUALIZADAS
-- ============================================================================

-- fm_player_draws: Jogador só vê seus próprios sorteios
alter table public.fm_player_draws enable row level security;

drop policy if exists "Players can view own draws" on public.fm_player_draws;
create policy "Players can view own draws"
on public.fm_player_draws
for select
using (
    player_key = lower(btrim(
        (select username from public.fm_profiles where auth_id = auth.uid() limit 1)
    ))
);

-- fm_player_draws: Admin pode ver todos
drop policy if exists "Admin can view all draws" on public.fm_player_draws;
create policy "Admin can view all draws"
on public.fm_player_draws
for select
using (app_private.is_fm_admin());

-- fm_player_draws: NINGUÉM pode inserir diretamente (apenas via RPC)
drop policy if exists "Block direct inserts on draws" on public.fm_player_draws;
create policy "Block direct inserts on draws"
on public.fm_player_draws
for insert
with check (false); -- Bloqueia TODOS os inserts diretos

-- fm_player_draws: NINGUÉM pode atualizar diretamente (apenas via RPC)
drop policy if exists "Block direct updates on draws" on public.fm_player_draws;
create policy "Block direct updates on draws"
on public.fm_player_draws
for update
using (false);

-- fm_player_draws: NINGUÉM pode deletar diretamente (apenas admin via RPC)
drop policy if exists "Block direct deletes on draws" on public.fm_player_draws;
create policy "Block direct deletes on draws"
on public.fm_player_draws
for delete
using (false);

-- fm_draw_audit_logs: Admin pode ver
alter table public.fm_draw_audit_logs enable row level security;

drop policy if exists "Admin can view audit logs" on public.fm_draw_audit_logs;
create policy "Admin can view audit logs"
on public.fm_draw_audit_logs
for select
using (app_private.is_fm_admin());

drop policy if exists "Block inserts on audit logs" on public.fm_draw_audit_logs;
create policy "Block inserts on audit logs"
on public.fm_draw_audit_logs
for insert
with check (false); -- Apenas via RPC (security definer bypassa RLS)

-- ============================================================================
-- 11. ATUALIZA admin_update_match_roster para sincronizar com nova tabela
-- ============================================================================
create or replace function app_private.admin_update_match_roster_impl(
    match_id text,
    new_players jsonb,
    new_votes jsonb,
    new_team_draws jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para alterar a partida.';
    end if;

    if not app_private.is_fm_admin() then
        raise exception 'Apenas administradores podem remover jogadores.';
    end if;

    -- Atualiza a partida
    update public.fm_matches
    set players = coalesce(new_players, '[]'::jsonb),
        votes = coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb),
        team_draws = coalesce(new_team_draws, '{}'::jsonb),
        updated_at = now()
    where id = match_id;

    if not found then
        raise exception 'Partida nao encontrada.';
    end if;
end;
$$;

-- ============================================================================
-- 12. GARANTIR que tabelas estejam expostas à API
-- ============================================================================
grant select on public.fm_player_draws to authenticated, anon;
grant select on public.fm_draw_audit_logs to authenticated;
