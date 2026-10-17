-- Uczenie z interakcji: wyuczone zainteresowania liczone na nowo z bieżących stanów i interakcji.
--
-- Wyuczony temat powstaje ostrożnie (ukryty, mała waga) po pierwszym polubieniu, a widocznym tagiem
-- staje się po polubieniu trzech różnych pozycji. `visible = false` = sygnał używany umiarkowanie
-- w rekomendacjach, jeszcze niepokazywany jako tag. Jawne i wykluczone tagi są zawsze widoczne.
alter table user_interest add column visible boolean not null default true;
-- Wynik z rejestru wkładów (po wygaszaniu w czasie) i liczba różnych polubionych pozycji.
alter table user_interest add column learned_score real;
alter table user_interest add column learned_items integer;
