-- trades.initialStop is the permanent 1R risk anchor. Once a trade is
-- created it must never move, even via an app bug or compromised role.
-- Note: the column is camelCase ("initialStop") because Prisma only maps
-- table names here (@@map), not column names — must be double-quoted in
-- raw SQL or Postgres folds it to lowercase and the lookup fails.
create or replace function sol_prevent_initial_stop_mutation()
returns trigger language plpgsql as $$
begin
  if new."initialStop" is distinct from old."initialStop" then
    raise exception 'trades.initialStop is immutable once set';
  end if;
  return new;
end;
$$;

drop trigger if exists trades_initial_stop_immutable on trades;
create trigger trades_initial_stop_immutable
  before update on trades
  for each row execute function sol_prevent_initial_stop_mutation();

-- trade_exits is an append-only event log, same guarantee as audit_logs.
create or replace function sol_prevent_trade_exit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'trade_exits is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists trade_exits_no_mutation on trade_exits;
create trigger trade_exits_no_mutation
  before update or delete on trade_exits
  for each row execute function sol_prevent_trade_exit_mutation();

-- trade_stop_moves is an append-only event log, same guarantee as audit_logs.
-- The stop is "moved" by appending a new row, never by editing one.
create or replace function sol_prevent_trade_stop_move_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'trade_stop_moves is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists trade_stop_moves_no_mutation on trade_stop_moves;
create trigger trade_stop_moves_no_mutation
  before update or delete on trade_stop_moves
  for each row execute function sol_prevent_trade_stop_move_mutation();
