-- Zadania okresowe (enqueue z `oncePerKey`) sprawdzają, czy zadanie o danym kluczu już się wykonało —
-- przy harmonogramie co kilka minut to częste zapytanie po `dedupe_key` we wszystkich statusach.
create index if not exists job_dedupe_key_idx on job (dedupe_key, status) where dedupe_key is not null;
