/**
 * Mała, ręcznie przygotowana taksonomia popularnych zainteresowań.
 * Służy do pytań onboardingu (DFS) — nie jest algorytmem wyszukiwania.
 *
 * Zasady:
 * - `id` jest stabilny i unikalny w całym drzewie (ścieżka kropkowa).
 * - `synonyms` pomagają dopasować własny tekst użytkownika do istniejącego węzła.
 * - Głębokość liczona od kategorii głównej; limit pogłębiania w DFS to `maxDepth`.
 */

export type IllustrationKey =
  | 'mountains'
  | 'tech'
  | 'science'
  | 'sport'
  | 'dance'
  | 'games'
  | 'music'
  | 'culture'
  | 'business'
  | 'auto'
  | 'food'
  | 'nature'
  | 'travel'
  | 'events'
  | 'generic';

export interface TaxonomyNode {
  id: string;
  label: string;
  synonyms?: string[];
  children?: TaxonomyNode[];
}

export interface RootCategory extends TaxonomyNode {
  illustration: IllustrationKey;
  description: string;
}

export const TAXONOMY: RootCategory[] = [
  {
    id: 'tech',
    label: 'Informatyka i technologia',
    illustration: 'tech',
    description: 'AI, programowanie, gadżety, hackathony',
    synonyms: ['informatyka', 'technologia', 'it', 'tech'],
    children: [
      {
        id: 'tech.ai',
        label: 'Sztuczna inteligencja',
        synonyms: ['ai', 'si', 'artificial intelligence'],
        children: [
          {
            id: 'tech.ai.agents',
            label: 'Agenci AI',
            synonyms: ['ai agents', 'agenci'],
            children: [
              { id: 'tech.ai.agents.rag', label: 'RAG', synonyms: ['retrieval augmented generation'] },
              { id: 'tech.ai.agents.tools', label: 'Narzędzia i function calling' },
              { id: 'tech.ai.agents.multi', label: 'Systemy wieloagentowe' },
            ],
          },
          { id: 'tech.ai.llm', label: 'Duże modele językowe', synonyms: ['llm', 'llmy'] },
          { id: 'tech.ai.vision', label: 'Widzenie komputerowe', synonyms: ['computer vision'] },
          { id: 'tech.ai.ethics', label: 'Etyka i regulacje AI', synonyms: ['ai act'] },
        ],
      },
      {
        id: 'tech.dev',
        label: 'Programowanie',
        synonyms: ['kodowanie', 'software', 'development'],
        children: [
          { id: 'tech.dev.web', label: 'Web i frontend' },
          { id: 'tech.dev.backend', label: 'Backend i chmura', synonyms: ['cloud'] },
          { id: 'tech.dev.mobile', label: 'Aplikacje mobilne' },
          { id: 'tech.dev.oss', label: 'Open source' },
        ],
      },
      { id: 'tech.security', label: 'Cyberbezpieczeństwo', synonyms: ['security', 'bezpieczeństwo it'] },
      { id: 'tech.hackathons', label: 'Hackathony', synonyms: ['hackathon', 'hackaton'] },
      { id: 'tech.gadgets', label: 'Sprzęt i gadżety', synonyms: ['gadżety', 'hardware', 'smartfony'] },
      { id: 'tech.startups', label: 'Startupy technologiczne' },
    ],
  },
  {
    id: 'science',
    label: 'Nauka',
    illustration: 'science',
    description: 'Kosmos, fizyka, biologia, medycyna',
    children: [
      { id: 'science.space', label: 'Kosmos i astronomia', synonyms: ['kosmos', 'astronomia', 'space'] },
      { id: 'science.physics', label: 'Fizyka' },
      { id: 'science.biology', label: 'Biologia i genetyka' },
      { id: 'science.medicine', label: 'Medycyna i zdrowie', synonyms: ['zdrowie'] },
      { id: 'science.math', label: 'Matematyka' },
      { id: 'science.psychology', label: 'Psychologia i neurobiologia' },
    ],
  },
  {
    id: 'mountains',
    label: 'Góry i outdoor',
    illustration: 'mountains',
    description: 'Szlaki, wspinaczka, narty',
    synonyms: ['góry', 'outdoor'],
    children: [
      {
        id: 'mountains.ranges',
        label: 'Pasma górskie',
        children: [
          { id: 'mountains.ranges.alps', label: 'Alpy', synonyms: ['alps'] },
          { id: 'mountains.ranges.tatras', label: 'Tatry' },
          { id: 'mountains.ranges.beskids', label: 'Beskidy' },
          { id: 'mountains.ranges.himalaya', label: 'Himalaje' },
        ],
      },
      { id: 'mountains.hiking', label: 'Trekking i szlaki', synonyms: ['trekking', 'turystyka górska'] },
      { id: 'mountains.climbing', label: 'Wspinaczka', synonyms: ['bouldering'] },
      { id: 'mountains.ski', label: 'Narciarstwo i skitury', synonyms: ['narty', 'snowboard'] },
    ],
  },
  {
    id: 'travel',
    label: 'Podróże',
    illustration: 'travel',
    description: 'Kierunki, city breaki, porady',
    children: [
      { id: 'travel.europe', label: 'Europa' },
      { id: 'travel.asia', label: 'Azja' },
      { id: 'travel.citybreak', label: 'City breaki' },
      { id: 'travel.budget', label: 'Tanie podróżowanie' },
    ],
  },
  {
    id: 'sport',
    label: 'Sport',
    illustration: 'sport',
    description: 'Piłka, bieganie, kolarstwo, F1',
    children: [
      { id: 'sport.football', label: 'Piłka nożna', synonyms: ['football', 'futbol'] },
      { id: 'sport.running', label: 'Bieganie', synonyms: ['maraton'] },
      { id: 'sport.cycling', label: 'Kolarstwo', synonyms: ['rower'] },
      { id: 'sport.volleyball', label: 'Siatkówka' },
      { id: 'sport.f1', label: 'Formuła 1', synonyms: ['f1'] },
      { id: 'sport.fitness', label: 'Siłownia i fitness', synonyms: ['siłownia', 'fitness'] },
    ],
  },
  {
    id: 'dance',
    label: 'Taniec',
    illustration: 'dance',
    description: 'Towarzyski, salsa, współczesny',
    children: [
      {
        id: 'dance.ballroom',
        label: 'Taniec towarzyski',
        synonyms: ['towarzyski', 'ballroom'],
        children: [
          { id: 'dance.ballroom.standard', label: 'Standardowe (walc, tango, foxtrot)' },
          { id: 'dance.ballroom.latin', label: 'Latynoamerykańskie (cha-cha, samba, rumba)' },
        ],
      },
      { id: 'dance.salsa', label: 'Salsa i bachata', synonyms: ['salsa', 'bachata'] },
      { id: 'dance.swing', label: 'Swing i lindy hop' },
      { id: 'dance.contemporary', label: 'Taniec współczesny' },
    ],
  },
  {
    id: 'games',
    label: 'Gry i szachy',
    illustration: 'games',
    description: 'Szachy, planszówki, e-sport',
    children: [
      {
        id: 'games.chess',
        label: 'Szachy',
        synonyms: ['chess'],
        children: [
          { id: 'games.chess.tournaments', label: 'Turnieje i arcymistrzowie' },
          { id: 'games.chess.openings', label: 'Debiuty i teoria' },
          { id: 'games.chess.online', label: 'Szachy online' },
        ],
      },
      { id: 'games.board', label: 'Gry planszowe', synonyms: ['planszówki'] },
      { id: 'games.video', label: 'Gry wideo', synonyms: ['gaming', 'gry komputerowe'] },
      { id: 'games.esport', label: 'E-sport' },
    ],
  },
  {
    id: 'music',
    label: 'Muzyka',
    illustration: 'music',
    description: 'Koncerty, gatunki, festiwale',
    children: [
      { id: 'music.concerts', label: 'Koncerty i festiwale' },
      { id: 'music.electronic', label: 'Muzyka elektroniczna' },
      { id: 'music.jazz', label: 'Jazz' },
      { id: 'music.classical', label: 'Muzyka klasyczna' },
      { id: 'music.rock', label: 'Rock i metal' },
      { id: 'music.hiphop', label: 'Hip-hop' },
    ],
  },
  {
    id: 'culture',
    label: 'Kultura i sztuka',
    illustration: 'culture',
    description: 'Film, teatr, książki, wystawy',
    children: [
      { id: 'culture.film', label: 'Film i seriale', synonyms: ['kino', 'seriale'] },
      { id: 'culture.theatre', label: 'Teatr' },
      { id: 'culture.books', label: 'Książki i literatura', synonyms: ['literatura', 'czytanie'] },
      { id: 'culture.art', label: 'Sztuki wizualne i wystawy', synonyms: ['wystawy', 'galerie'] },
      { id: 'culture.photo', label: 'Fotografia' },
      { id: 'culture.history', label: 'Historia' },
    ],
  },
  {
    id: 'business',
    label: 'Biznes i finanse',
    illustration: 'business',
    description: 'Startupy, rynki, kariera',
    children: [
      { id: 'business.startups', label: 'Startupy i przedsiębiorczość' },
      { id: 'business.markets', label: 'Rynki i gospodarka', synonyms: ['gospodarka', 'ekonomia'] },
      { id: 'business.career', label: 'Kariera i rozwój zawodowy', synonyms: ['kariera'] },
      { id: 'business.marketing', label: 'Marketing' },
    ],
  },
  {
    id: 'auto',
    label: 'Motoryzacja',
    illustration: 'auto',
    description: 'Elektryki, nowe modele, wyścigi',
    children: [
      {
        id: 'auto.ev',
        label: 'Samochody elektryczne',
        synonyms: ['elektryki', 'ev'],
        children: [
          { id: 'auto.ev.tesla', label: 'Tesla (samochody)', synonyms: ['tesla motors', 'tesla inc'] },
          { id: 'auto.ev.charging', label: 'Ładowanie i infrastruktura' },
          { id: 'auto.ev.batteries', label: 'Baterie' },
        ],
      },
      { id: 'auto.new', label: 'Nowe modele i testy' },
      { id: 'auto.classic', label: 'Klasyki i youngtimery' },
    ],
  },
  {
    id: 'food',
    label: 'Kulinaria',
    illustration: 'food',
    description: 'Gotowanie, kawa, restauracje',
    children: [
      { id: 'food.cooking', label: 'Gotowanie i przepisy', synonyms: ['gotowanie'] },
      { id: 'food.coffee', label: 'Kawa' },
      { id: 'food.vege', label: 'Kuchnia roślinna', synonyms: ['wege', 'vegan'] },
      { id: 'food.restaurants', label: 'Restauracje' },
    ],
  },
  {
    id: 'nature',
    label: 'Przyroda i klimat',
    illustration: 'nature',
    description: 'Ekologia, zwierzęta, energia',
    children: [
      { id: 'nature.climate', label: 'Klimat i energia', synonyms: ['klimat', 'oze'] },
      { id: 'nature.animals', label: 'Zwierzęta' },
      { id: 'nature.ecology', label: 'Ekologia i zrównoważony rozwój', synonyms: ['ekologia'] },
    ],
  },
];

export const DEFAULT_MAX_DEPTH = 4;

export interface IndexedNode {
  node: TaxonomyNode;
  rootId: string;
  parentId: string | null;
  depth: number; // 0 = kategoria główna
  path: string[]; // ID od korzenia do węzła włącznie
}

function buildIndex(): Map<string, IndexedNode> {
  const map = new Map<string, IndexedNode>();
  const walk = (node: TaxonomyNode, rootId: string, parentId: string | null, path: string[]) => {
    if (map.has(node.id)) throw new Error(`Zduplikowane ID taksonomii: ${node.id}`);
    const nodePath = [...path, node.id];
    map.set(node.id, { node, rootId, parentId, depth: nodePath.length - 1, path: nodePath });
    for (const child of node.children ?? []) walk(child, rootId, node.id, nodePath);
  };
  for (const root of TAXONOMY) walk(root, root.id, null, []);
  return map;
}

export const TAXONOMY_INDEX = buildIndex();

export function getNode(id: string): IndexedNode | undefined {
  return TAXONOMY_INDEX.get(id);
}

export function getRoot(id: string): RootCategory | undefined {
  return TAXONOMY.find((r) => r.id === id);
}
