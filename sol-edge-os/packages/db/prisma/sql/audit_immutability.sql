-- Make audit_logs physically append-only. App-level discipline is not enough;
-- this enforces immutability at the database so history cannot be rewritten,
-- even by a compromised app role.

create or replace function sol_prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only: % is not permitted', tg_op;
end;
$$;

drop trigger if exists audit_logs_no_mutation on audit_logs;
create trigger audit_logs_no_mutation
  before update or delete on audit_logs
  for each row execute function sol_prevent_mutation();
