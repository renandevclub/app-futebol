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

create or replace function public.admin_update_match_roster(
    match_id text,
    new_players jsonb,
    new_votes jsonb,
    new_team_draws jsonb
)
returns void
language sql
security invoker
set search_path = public, app_private
as $$
    select app_private.admin_update_match_roster_impl(match_id, new_players, new_votes, new_team_draws);
$$;

revoke all on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) from public;
revoke all on function app_private.admin_update_match_roster_impl(text, jsonb, jsonb, jsonb) from public;
revoke execute on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) from anon;
revoke execute on function app_private.admin_update_match_roster_impl(text, jsonb, jsonb, jsonb) from anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.admin_update_match_roster_impl(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.admin_update_match_roster(text, jsonb, jsonb, jsonb) to authenticated;
