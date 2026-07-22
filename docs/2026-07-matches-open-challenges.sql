-- Allows opponent_name to be null, for "open to anyone" 1v1 challenges that
-- have no specific target yet — whoever accepts first fills it in.
--
-- Paste this into Supabase -> SQL Editor -> New query -> Run.
-- Safe to re-run.

alter table matches alter column opponent_name drop not null;
