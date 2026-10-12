/**
 * Maszyna stanów pogłębiania zainteresowań w onboardingu (kolejność DFS).
 *
 * DFS opisuje wyłącznie kolejność pytań: jeśli użytkownik wybierze kilka podkategorii,
 * pierwsza jest pogłębiana do końca, potem jej rodzeństwo, dopiero potem kolejna
 * kategoria główna. Stan jest czystym obiektem JSON — zapisywany w bazie, co pozwala
 * wznowić onboarding na innym urządzeniu.
 *
 * Akcje: start → (answer | skip | back)* → enough | wyczerpanie stosu.
 * - „Pomiń” (skip): nie pogłębiaj bieżącej gałęzi, przejdź dalej.
 * - „Wystarczy” (enough): zakończ cały etap pogłębiania i przejdź do przeglądu tagów.
 * - „Wstecz” (back): przywróć stan sprzed ostatniej akcji.
 */
import { DEFAULT_MAX_DEPTH, TAXONOMY, getNode } from './taxonomy.ts';
import { findSenses, matchTaxonomy, normalizeTag, type Sense } from './normalize.ts';

export type SelectionSource = 'taxonomy' | 'custom';

export interface Selection {
  key: string;
  /** Etykieta w oryginalnym brzmieniu (taksonomia lub tekst użytkownika). */
  label: string;
  normalized: string;
  nodeId: string | null;
  source: SelectionSource;
  /** Etykiety od kategorii głównej do tego węzła włącznie. */
  path: string[];
  /** Klucze od kategorii głównej do tego węzła włącznie. */
  pathKeys: string[];
  depth: number;
}

interface Core {
  maxDepth: number;
  roots: string[];
  selections: Record<string, Selection>;
  /** Kolejność wyboru — stabilna prezentacja tagów. */
  order: string[];
  /** Oczekujące węzły; wierzchołek stosu to ostatni element. */
  stack: string[];
  current: string | null;
  completed: string[];
  done: boolean;
}

export interface DfsState extends Core {
  version: 1;
  history: Core[];
}

export interface CustomAnswer {
  label: string;
  /** Wybrane znaczenie, gdy etykieta jest wieloznaczna (np. „Tesla”). */
  sense?: string;
}

export interface DfsQuestion {
  key: string;
  label: string;
  path: string[];
  depth: number;
  options: { id: string; label: string }[];
}

export class DfsError extends Error {
  constructor(
    public code: 'NOT_STARTED' | 'FINISHED' | 'INVALID_OPTION' | 'NO_ROOTS' | 'AMBIGUOUS' | 'NOTHING_TO_UNDO',
    message: string,
    public senses?: { label: string; senses: Sense[] },
  ) {
    super(message);
  }
}

const HISTORY_LIMIT = 40;
const MAX_CUSTOM_LABEL = 60;

export function createDfsState(maxDepth = DEFAULT_MAX_DEPTH): DfsState {
  return {
    version: 1,
    maxDepth,
    roots: [],
    selections: {},
    order: [],
    stack: [],
    current: null,
    completed: [],
    done: false,
    history: [],
  };
}

function core(state: DfsState): Core {
  const { version: _v, history: _h, ...rest } = state;
  return structuredClone(rest);
}

function withHistory(prev: DfsState, next: Core): DfsState {
  const history = [...prev.history, core(prev)].slice(-HISTORY_LIMIT);
  return { version: 1, ...next, history };
}

/** Opcje pytania dla węzła: dzieci z taksonomii bez już wybranych i bez przodków (brak cykli). */
function optionsFor(s: Core, key: string): { id: string; label: string }[] {
  const sel = s.selections[key];
  if (!sel || !sel.nodeId) return []; // własne etykiety rozwinie AI w kolejnym etapie
  if (sel.depth >= s.maxDepth) return [];
  const indexed = getNode(sel.nodeId);
  const taken = new Set(Object.values(s.selections).map((x) => x.normalized));
  return (indexed?.node.children ?? [])
    .filter((c) => !s.selections[c.id] && !sel.pathKeys.includes(c.id) && !taken.has(normalizeTag(c.label)))
    .map((c) => ({ id: c.id, label: c.label }));
}

/** Zdejmuje ze stosu węzły bez pytań (liście, limit głębokości) aż do pierwszego pytania. */
function advance(s: Core): Core {
  s.current = null;
  while (s.stack.length > 0) {
    const key = s.stack.pop()!;
    if (s.completed.includes(key)) continue;
    if (optionsFor(s, key).length > 0) {
      s.current = key;
      return s;
    }
    s.completed.push(key);
  }
  s.done = true;
  return s;
}

function addSelection(s: Core, sel: Selection): boolean {
  if (s.selections[sel.key]) return false;
  if (Object.values(s.selections).some((x) => x.normalized === sel.normalized)) return false;
  s.selections[sel.key] = sel;
  s.order.push(sel.key);
  return true;
}

function taxonomySelection(nodeId: string): Selection {
  const indexed = getNode(nodeId);
  if (!indexed) throw new DfsError('INVALID_OPTION', `Nieznany węzeł: ${nodeId}`);
  const path = indexed.path.map((id) => getNode(id)!.node.label);
  return {
    key: nodeId,
    label: indexed.node.label,
    normalized: normalizeTag(indexed.node.label),
    nodeId,
    source: 'taxonomy',
    path,
    pathKeys: indexed.path,
    depth: indexed.depth,
  };
}

/**
 * Zamienia własny tekst na wybór. Zwraca węzeł taksonomii, jeśli tekst jest jego etykietą/synonimem.
 * Wieloznaczne hasło bez wskazanego znaczenia kończy się błędem AMBIGUOUS z listą znaczeń.
 */
function resolveCustom(s: Core, answer: CustomAnswer, parent: Selection | null): Selection | null {
  const raw = answer.label.trim().slice(0, MAX_CUSTOM_LABEL);
  if (!raw) return null;

  const senses = findSenses(raw);
  let label = raw;
  let nodeId: string | undefined;
  if (senses) {
    const chosen = senses.find((x) => x.label === answer.sense);
    if (!chosen) throw new DfsError('AMBIGUOUS', `„${raw}” ma kilka znaczeń`, { label: raw, senses });
    label = chosen.label;
    nodeId = chosen.nodeId;
  } else {
    nodeId = matchTaxonomy(raw);
  }

  if (nodeId) {
    // Dopasowanie do przodka bieżącej ścieżki byłoby cyklem — ignorujemy.
    if (parent?.pathKeys.includes(nodeId)) return null;
    return taxonomySelection(nodeId);
  }

  const normalized = normalizeTag(label);
  const key = parent ? `custom:${parent.key}/${normalized}` : `custom:${normalized}`;
  return {
    key,
    label,
    normalized,
    nodeId: null,
    source: 'custom',
    path: [...(parent?.path ?? []), label],
    pathKeys: [...(parent?.pathKeys ?? []), key],
    depth: parent ? parent.depth + 1 : 0,
  };
}

/** Krok 5: wybór kategorii głównych (z listy i/lub własnym tekstem). */
export function startDfs(state: DfsState, rootIds: string[], custom: CustomAnswer[] = []): DfsState {
  const s = core(state);
  const known = new Set(TAXONOMY.map((r) => r.id));
  for (const id of rootIds) {
    if (!known.has(id)) throw new DfsError('INVALID_OPTION', `Nieznana kategoria: ${id}`);
  }
  s.roots = [];
  s.selections = {};
  s.order = [];
  s.completed = [];
  s.done = false;

  const added: string[] = [];
  for (const id of rootIds) if (addSelection(s, taxonomySelection(id))) added.push(id);
  for (const c of custom) {
    const sel = resolveCustom(s, c, null);
    if (sel && addSelection(s, sel)) added.push(sel.key);
  }
  if (added.length === 0) throw new DfsError('NO_ROOTS', 'Wybierz co najmniej jedno zainteresowanie');

  s.roots = added;
  s.stack = [...added].reverse();
  return withHistory(state, advance(s));
}

/** Odpowiedź na pytanie o bieżący węzeł: wybrane podkategorie i/lub własne etykiety. */
export function answerDfs(state: DfsState, optionIds: string[], custom: CustomAnswer[] = []): DfsState {
  if (state.done) throw new DfsError('FINISHED', 'Pogłębianie jest już zakończone');
  if (!state.current) throw new DfsError('NOT_STARTED', 'Brak bieżącego pytania');
  const s = core(state);
  const currentKey = s.current!;
  const parent = s.selections[currentKey]!;
  const allowed = new Set(optionsFor(s, currentKey).map((o) => o.id));

  const added: string[] = [];
  for (const id of optionIds) {
    if (!allowed.has(id)) throw new DfsError('INVALID_OPTION', `Opcja ${id} nie pasuje do pytania`);
    if (addSelection(s, taxonomySelection(id))) added.push(id);
  }
  for (const c of custom) {
    const sel = resolveCustom(s, c, parent);
    if (sel && addSelection(s, sel)) added.push(sel.key);
  }

  s.completed.push(currentKey);
  // Dzieci na wierzch stosu w odwrotnej kolejności → pierwsze wybrane pogłębiane jako pierwsze,
  // a rodzeństwo i kolejne kategorie główne czekają pod spodem.
  for (const key of [...added].reverse()) s.stack.push(key);
  return withHistory(state, advance(s));
}

export function skipDfs(state: DfsState): DfsState {
  if (state.done) throw new DfsError('FINISHED', 'Pogłębianie jest już zakończone');
  if (!state.current) throw new DfsError('NOT_STARTED', 'Brak bieżącego pytania');
  const s = core(state);
  s.completed.push(s.current!);
  return withHistory(state, advance(s));
}

export function enoughDfs(state: DfsState): DfsState {
  const s = core(state);
  s.current = null;
  s.done = true;
  return withHistory(state, s);
}

export function backDfs(state: DfsState): DfsState {
  const prev = state.history.at(-1);
  if (!prev) throw new DfsError('NOTHING_TO_UNDO', 'Nie ma czego cofnąć');
  return { version: 1, ...structuredClone(prev), history: state.history.slice(0, -1) };
}

export function currentQuestion(state: DfsState): DfsQuestion | null {
  if (state.done || !state.current) return null;
  const sel = state.selections[state.current];
  if (!sel) return null;
  return {
    key: sel.key,
    label: sel.label,
    path: sel.path,
    depth: sel.depth,
    options: optionsFor(state, sel.key),
  };
}

/** Wybrane zainteresowania w kolejności wyboru (zarówno ogólne, jak i liście). */
export function dfsSelections(state: DfsState): Selection[] {
  return state.order.map((k) => state.selections[k]!).filter(Boolean);
}

/**
 * Liczba pytań, które na pewno jeszcze padną (bieżące + gałęzie ze stosu, które mają podkategorie).
 * Dolne oszacowanie — nowe wybory mogą dodać kolejne pytania.
 */
export function pendingCount(state: DfsState): number {
  const queued = state.stack.filter((k) => !state.completed.includes(k) && optionsFor(state, k).length > 0).length;
  return queued + (state.current ? 1 : 0);
}
