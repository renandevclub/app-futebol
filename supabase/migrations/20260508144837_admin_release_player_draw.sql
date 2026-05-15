create or replace function app_private.admin_release_player_draw_impl(
    match_id text,
    player_username text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    player_key text := lower(btrim(coalesce(player_username, '')));
    match_record public.fm_matches%rowtype;
    updated_players jsonb;
    matched_count integer;
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para liberar novo sorteio.';
    end if;

    if not app_private.is_fm_admin() then
        raise exception 'Apenas administradores podem liberar novo sorteio.';
    end if;

    if player_key = '' then
        raise exception 'Jogador invalido.';
    end if;

    select *
    into match_record
    from public.fm_matches
    where id = match_id
    for update;

    if not found then
        raise exception 'Partida nao encontrada.';
    end if;

    select
        coalesce(jsonb_agg(
            case
                when lower(btrim(player.value->>'username')) = player_key then
                    player.value - 'teamId' - 'teamName' - 'assignmentMode' - 'drawnAt'
                else
                    player.value
            end
            order by player.position
        ), '[]'::jsonb),
        count(*) filter (where lower(btrim(player.value->>'username')) = player_key)::integer
    into updated_players, matched_count
    from jsonb_array_elements(coalesce(match_record.players, '[]'::jsonb)) with ordinality as player(value, position);

    if matched_count = 0 and not (coalesce(match_record.team_draws, '{}'::jsonb) ? player_key) then
        raise exception 'Jogador nao encontrado na lista de confirmados.';
    end if;

    update public.fm_matches
    set players = updated_players,
        team_draws = coalesce(match_record.team_draws, '{}'::jsonb) - player_key,
        updated_at = now()
    where id = match_id;
end;
$$;

create or replace function public.admin_release_player_draw(
    match_id text,
    player_username text
)
returns void
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.admin_release_player_draw_impl(match_id, player_username);
$$;

revoke all on function public.admin_release_player_draw(text, text) from public;
revoke all on function app_private.admin_release_player_draw_impl(text, text) from public;
revoke execute on function public.admin_release_player_draw(text, text) from anon;
revoke execute on function app_private.admin_release_player_draw_impl(text, text) from anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.admin_release_player_draw_impl(text, text) to authenticated;
grant execute on function public.admin_release_player_draw(text, text) to authenticated;

create or replace function app_private.player_draw_team_impl(match_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    current_username text;
    current_key text;
    match_record public.fm_matches%rowtype;
    existing_player jsonb;
    existing_draw jsonb;
    selected_team jsonb;
    selected_team_id text;
    selected_team_name text;
    draw_timestamp text := to_jsonb(now()) #>> '{}';
    assignment jsonb;
    player_entry jsonb;
    updated_players jsonb;
    result_status text;
begin
    if auth.uid() is null then
        raise exception 'Voce precisa estar logado para sortear o time.';
    end if;

    select username
    into current_username
    from public.fm_profiles
    where auth_id = auth.uid()
    limit 1;

    if current_username is null or btrim(current_username) = '' then
        raise exception 'Perfil de jogador nao encontrado.';
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

    if jsonb_typeof(match_record.teams) <> 'array'
        or jsonb_array_length(match_record.teams) < 3 then
        raise exception 'O sorteio so fica disponivel com 3 ou mais times cadastrados.';
    end if;

    select player.value
    into existing_player
    from jsonb_array_elements(match_record.players) as player(value)
    where lower(btrim(player.value->>'username')) = current_key
    limit 1;

    if existing_player is not null
        and coalesce(btrim(existing_player->>'teamId'), '') <> '' then
        return jsonb_build_object(
            'status', 'already_joined',
            'assignment', jsonb_build_object(
                'teamId', existing_player->>'teamId',
                'teamName', existing_player->>'teamName',
                'username', current_username
            ),
            'player', existing_player
        );
    end if;

    existing_draw := case
        when existing_player is null then null
        else match_record.team_draws -> current_key
    end;

    if existing_draw is not null then
        selected_team_id := existing_draw->>'teamId';
        selected_team_name := existing_draw->>'teamName';
        result_status := 'existing_draw_joined';

        if not exists (
            select 1
            from jsonb_array_elements(match_record.teams) as team(value)
            where team.value->>'id' = selected_team_id
        ) then
            raise exception 'Seu time sorteado anteriormente nao esta mais cadastrado nesta partida. Procure o administrador.';
        end if;
    else
        with team_rows as (
            select
                team.value as team_data,
                team.value->>'id' as team_id,
                team.value->>'name' as team_name
            from jsonb_array_elements(match_record.teams) with ordinality as team(value, position)
            where coalesce(btrim(team.value->>'id'), '') <> ''
              and coalesce(btrim(team.value->>'name'), '') <> ''
        ),
        team_counts as (
            select
                team_rows.team_data,
                team_rows.team_id,
                count(player.value) as player_count
            from team_rows
            left join jsonb_array_elements(match_record.players) as player(value)
                on player.value->>'teamId' = team_rows.team_id
            group by team_rows.team_data, team_rows.team_id
        )
        select team_data
        into selected_team
        from team_counts
        order by player_count asc, random()
        limit 1;

        if selected_team is null then
            raise exception 'Nenhum time valido encontrado para o sorteio.';
        end if;

        selected_team_id := selected_team->>'id';
        selected_team_name := selected_team->>'name';
        result_status := case when existing_player is null then 'drawn' else 'redrawn' end;
    end if;

    assignment := jsonb_build_object(
        'username', current_username,
        'teamId', selected_team_id,
        'teamName', selected_team_name,
        'drawnAt', coalesce(existing_draw->>'drawnAt', draw_timestamp)
    );

    player_entry := coalesce(existing_player, jsonb_build_object(
        'username', current_username,
        'paid', false,
        'receiptSent', false
    )) - 'teamId' - 'teamName' - 'assignmentMode' - 'drawnAt';

    player_entry := player_entry || jsonb_build_object(
        'teamId', selected_team_id,
        'teamName', selected_team_name,
        'assignmentMode', 'draw',
        'drawnAt', coalesce(existing_draw->>'drawnAt', draw_timestamp)
    );

    if existing_player is not null then
        select coalesce(jsonb_agg(
            case
                when lower(btrim(player.value->>'username')) = current_key then player_entry
                else player.value
            end
            order by player.position
        ), '[]'::jsonb)
        into updated_players
        from jsonb_array_elements(match_record.players) with ordinality as player(value, position);

        update public.fm_matches
        set players = updated_players,
            team_draws = match_record.team_draws || jsonb_build_object(current_key, assignment),
            updated_at = now()
        where id = match_id;
    else
        update public.fm_matches
        set players = match_record.players || jsonb_build_array(player_entry),
            team_draws = match_record.team_draws || jsonb_build_object(current_key, assignment),
            updated_at = now()
        where id = match_id;
    end if;

    return jsonb_build_object(
        'status', result_status,
        'assignment', assignment,
        'player', player_entry
    );
end;
$$;

grant execute on function app_private.player_draw_team_impl(text) to authenticated;
