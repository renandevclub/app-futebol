-- ============================================================================
-- MIGRATION: Sincronizacao atomica entre fm_matches.players e fm_player_draws
-- Data: 2026-05-09
-- Objetivo: Garantir que remover um jogador da lista de confirmados tambem
--           libere automaticamente seu sorteio em fm_player_draws.
--           Isso evita que o codigo de reconciliacao no frontend readicione
--           jogadores removidos ao recarregar a pagina.
-- ============================================================================

-- ============================================================================
-- 1. ATUALIZA admin_update_match_roster_impl para liberar draws de removidos
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
declare
    v_admin_username text;
    v_curr_players jsonb;
    v_removed text;
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para alterar a partida.';
    end if;

    if not app_private.is_fm_admin() then
        raise exception 'Apenas administradores podem remover jogadores.';
    end if;

    v_admin_username := app_private.get_current_player_username();

    select players into v_curr_players
    from public.fm_matches
    where id = match_id
    for update;

    if not found then
        raise exception 'Partida nao encontrada.';
    end if;

    for v_removed in
        select lower(btrim(old_player.value->>'username'))
        from jsonb_array_elements(coalesce(v_curr_players, '[]'::jsonb)) as old_player(value)
        where not exists (
            select 1
            from jsonb_array_elements(coalesce(new_players, '[]'::jsonb)) as new_player(value)
            where lower(btrim(new_player.value->>'username'))
                = lower(btrim(old_player.value->>'username'))
        )
    loop
        update public.fm_player_draws
        set status = 'released',
            released_at = now(),
            released_by = v_admin_username,
            release_reason = 'Jogador removido da partida pelo administrador.',
            updated_at = now()
        where match_id = admin_update_match_roster_impl.match_id
          and player_key = v_removed
          and status = 'drawn';
    end loop;

    update public.fm_matches
    set players = coalesce(new_players, '[]'::jsonb),
        votes = coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb),
        team_draws = coalesce(new_team_draws, '{}'::jsonb),
        updated_at = now()
    where id = match_id;
end;
$$;

-- Reaplica permissoes da funcao wrapper
revoke all on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) from public;
revoke execute on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) from anon;
grant execute on function app_private.admin_update_match_roster_impl(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================================
-- 2. ATUALIZA player_update_match_impl para liberar draw ao sair da partida
-- ============================================================================
create or replace function app_private.player_update_match_impl(match_id text, new_players jsonb, new_votes jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    current_username text;
    current_key text;
    match_record public.fm_matches%rowtype;
    old_player jsonb;
    new_player jsonb;
    old_without_user jsonb;
    new_without_user jsonb;
    old_votes_without_user jsonb;
    new_votes_without_user jsonb;
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para alterar a partida.';
    end if;

    select username
    into current_username
    from public.fm_profiles
    where auth_id = auth.uid()
    limit 1;

    if current_username is null or btrim(current_username) = '' then
        raise exception 'Perfil de jogador nao encontrado.';
    end if;

    if app_private.is_fm_admin() then
        update public.fm_matches
        set players = coalesce(new_players, '[]'::jsonb),
            votes = coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb),
            updated_at = now()
        where id = match_id;
        return;
    end if;

    current_key := lower(btrim(current_username));

    select *
    into match_record
    from public.fm_matches
    where id = match_id
    for update;

    if not found then
        raise exception 'Partida nao encontrada.';
    end if;

    select player.value
    into old_player
    from jsonb_array_elements(match_record.players) as player(value)
    where lower(btrim(player.value->>'username')) = current_key
    limit 1;

    select player.value
    into new_player
    from jsonb_array_elements(coalesce(new_players, '[]'::jsonb)) as player(value)
    where lower(btrim(player.value->>'username')) = current_key
    limit 1;

    old_without_user := app_private.fm_players_without_user(match_record.players, current_key);
    new_without_user := app_private.fm_players_without_user(coalesce(new_players, '[]'::jsonb), current_key);

    if old_without_user <> new_without_user then
        raise exception 'Jogadores so podem alterar a propria participacao.';
    end if;

    if old_player is null and new_player is not null then
        if jsonb_typeof(match_record.teams) = 'array'
            and jsonb_array_length(match_record.teams) >= 3 then
            raise exception 'Esta partida exige sorteio de time para participar.';
        end if;

        if coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb) <> match_record.votes then
            raise exception 'Nao altere votos ao confirmar presenca.';
        end if;

        update public.fm_matches
        set players = new_players,
            updated_at = now()
        where id = match_id;
        return;
    end if;

    if old_player is not null and new_player is null then
        if coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb) <> match_record.votes then
            raise exception 'Nao altere votos ao sair da partida.';
        end if;

        -- Libera o sorteio ativo do jogador ao sair da partida
        update public.fm_player_draws
        set status = 'released',
            released_at = now(),
            released_by = current_username,
            release_reason = 'Jogador cancelou participacao.',
            updated_at = now()
        where match_id = player_update_match_impl.match_id
          and player_key = current_key
          and status = 'drawn';

        update public.fm_matches
        set players = new_players,
            team_draws = coalesce(match_record.team_draws, '{}'::jsonb) - current_key,
            updated_at = now()
        where id = match_id;
        return;
    end if;

    if old_player is not null and new_player is not null then
        if match_record.players <> coalesce(new_players, '[]'::jsonb) then
            raise exception 'Jogadores nao podem alterar dados da lista manualmente.';
        end if;

        old_votes_without_user := app_private.fm_votes_without_user(match_record.votes, current_key);
        new_votes_without_user := app_private.fm_votes_without_user(coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb), current_key);

        if old_votes_without_user <> new_votes_without_user then
            raise exception 'Jogadores so podem alterar os proprios votos.';
        end if;

        update public.fm_matches
        set votes = coalesce(new_votes, '{"best_player":[],"worst_player":[]}'::jsonb),
            updated_at = now()
        where id = match_id;
        return;
    end if;

    raise exception 'Alteracao nao permitida para este jogador.';
end;
$$;

-- Reaplica permissoes
revoke all on function public.player_update_match(text, jsonb, jsonb) from public;
revoke execute on function public.player_update_match(text, jsonb, jsonb) from anon;
grant execute on function app_private.player_update_match_impl(text, jsonb, jsonb) to authenticated;
grant execute on function public.player_update_match(text, jsonb, jsonb) to authenticated;
