alter table public.fm_matches
    add column if not exists teams jsonb not null default '[]'::jsonb,
    add column if not exists team_draws jsonb not null default '{}'::jsonb;

alter table public.fm_matches
    drop constraint if exists fm_matches_teams_is_array,
    add constraint fm_matches_teams_is_array
        check (jsonb_typeof(teams) = 'array');

alter table public.fm_matches
    drop constraint if exists fm_matches_team_draws_is_object,
    add constraint fm_matches_team_draws_is_object
        check (jsonb_typeof(team_draws) = 'object');

comment on column public.fm_matches.teams is
    'Times participantes da partida. Quando houver 3 ou mais times, a roleta de sorteio fica habilitada.';

comment on column public.fm_matches.team_draws is
    'Historico de sorteios por jogador na partida, indexado pelo username normalizado em lowercase.';

create or replace function app_private.fm_votes_without_user(votes_payload jsonb, username_key text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'best_player',
        coalesce((
            select jsonb_agg(vote.value order by vote.position)
            from jsonb_array_elements(coalesce(votes_payload->'best_player', '[]'::jsonb)) with ordinality as vote(value, position)
            where lower(btrim(vote.value->>'voter')) <> username_key
        ), '[]'::jsonb),
        'worst_player',
        coalesce((
            select jsonb_agg(vote.value order by vote.position)
            from jsonb_array_elements(coalesce(votes_payload->'worst_player', '[]'::jsonb)) with ordinality as vote(value, position)
            where lower(btrim(vote.value->>'voter')) <> username_key
        ), '[]'::jsonb)
    );
$$;

create or replace function app_private.fm_players_without_user(players_payload jsonb, username_key text)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
    select coalesce((
        select jsonb_agg(player.value order by player.position)
        from jsonb_array_elements(coalesce(players_payload, '[]'::jsonb)) with ordinality as player(value, position)
        where lower(btrim(player.value->>'username')) <> username_key
    ), '[]'::jsonb);
$$;

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

        update public.fm_matches
        set players = new_players,
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

create or replace function public.player_update_match(match_id text, new_players jsonb, new_votes jsonb)
returns void
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.player_update_match_impl(match_id, new_players, new_votes);
$$;

revoke all on function public.player_update_match(text, jsonb, jsonb) from public;
grant execute on function app_private.fm_votes_without_user(jsonb, text) to authenticated;
grant execute on function app_private.fm_players_without_user(jsonb, text) to authenticated;
grant execute on function app_private.player_update_match_impl(text, jsonb, jsonb) to authenticated;
grant execute on function public.player_update_match(text, jsonb, jsonb) to authenticated;

create or replace function app_private.get_player_phone_impl(p_username text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    player_phone text;
begin
    if not app_private.is_fm_admin() then
        raise exception 'Apenas administradores podem consultar telefone de jogadores.';
    end if;

    select phone
    into player_phone
    from public.fm_profiles
    where lower(username) = lower(p_username)
    limit 1;

    return player_phone;
end;
$$;

create or replace function public.get_player_phone(p_username text)
returns text
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.get_player_phone_impl(p_username);
$$;

revoke all on function public.get_player_phone(text) from public;
grant execute on function app_private.get_player_phone_impl(text) to authenticated;
grant execute on function public.get_player_phone(text) to authenticated;

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

    if existing_player is not null then
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

    existing_draw := match_record.team_draws -> current_key;

    if existing_draw is not null then
        selected_team_id := existing_draw->>'teamId';
        selected_team_name := existing_draw->>'teamName';

        if not exists (
            select 1
            from jsonb_array_elements(match_record.teams) as team(value)
            where team.value->>'id' = selected_team_id
        ) then
            raise exception 'Seu time sorteado anteriormente nao esta mais cadastrado nesta partida. Procure o administrador.';
        end if;

        player_entry := jsonb_build_object(
            'username', current_username,
            'paid', false,
            'receiptSent', false,
            'teamId', selected_team_id,
            'teamName', selected_team_name,
            'assignmentMode', 'draw',
            'drawnAt', coalesce(existing_draw->>'drawnAt', draw_timestamp)
        );

        update public.fm_matches
        set players = match_record.players || jsonb_build_array(player_entry),
            updated_at = now()
        where id = match_id;

        return jsonb_build_object(
            'status', 'existing_draw_joined',
            'assignment', existing_draw,
            'player', player_entry
        );
    end if;

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

    assignment := jsonb_build_object(
        'username', current_username,
        'teamId', selected_team_id,
        'teamName', selected_team_name,
        'drawnAt', draw_timestamp
    );

    player_entry := jsonb_build_object(
        'username', current_username,
        'paid', false,
        'receiptSent', false,
        'teamId', selected_team_id,
        'teamName', selected_team_name,
        'assignmentMode', 'draw',
        'drawnAt', draw_timestamp
    );

    update public.fm_matches
    set players = match_record.players || jsonb_build_array(player_entry),
        team_draws = match_record.team_draws || jsonb_build_object(current_key, assignment),
        updated_at = now()
    where id = match_id;

    return jsonb_build_object(
        'status', 'drawn',
        'assignment', assignment,
        'player', player_entry
    );
end;
$$;

create or replace function public.player_draw_team(match_id text)
returns jsonb
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.player_draw_team_impl(match_id);
$$;

revoke all on function public.player_draw_team(text) from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.player_draw_team_impl(text) to authenticated;
grant execute on function public.player_draw_team(text) to authenticated;
