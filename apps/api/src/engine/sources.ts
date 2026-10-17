/**
 * Źródła odkrywania treści per węzeł taksonomii.
 *
 * Kanały RSS: darmowe, sprawdzone ręcznie (12.10.2026). Kanał przypisany do węzła obsługuje też
 * jego potomków (kanał szachowy służy „Turniejom i arcymistrzom”).
 *
 * Zapytania wyszukiwarki: ręcznie dobrane, konkretne frazy. Kalibracja pokazała, że ogólne etykiety
 * („programowanie”, „Alpy”) dają szum (np. Alpy → Aleph Alpha, notowania ALPHA), a konkretne frazy
 * („AI agents”, „chess tournament grandmaster”) — 15–20 trafnych wyników na 20.
 * Węzły główne (np. „Informatyka i technologia”) celowo nie mają zapytań: pokrywają je kanały,
 * a szerokie zapytanie zużywa limit i daje słabe wyniki.
 */
import { getNode } from '@readyou/shared';

export interface PlannedQuery {
  q: string;
  lang: 'pl' | 'en';
  /** Kod kraju albo brak dla wyników globalnych (anglojęzyczne). */
  country?: string;
}

const pl = (q: string): PlannedQuery => ({ q, lang: 'pl', country: 'PL' });
const en = (q: string): PlannedQuery => ({ q, lang: 'en' });

export const FEEDS: Record<string, string[]> = {
  tech: ['https://antyweb.pl/feed', 'https://www.chip.pl/feed', 'https://spidersweb.pl/feed'],
  'tech.ai': ['https://huggingface.co/blog/feed.xml', 'https://simonwillison.net/atom/everything/', 'https://www.marktechpost.com/feed/'],
  'games.chess': ['https://en.chessbase.com/feed', 'https://www.chess.com/rss/news'],
  'auto.ev.tesla': ['https://electrek.co/guides/tesla/feed/', 'https://www.teslarati.com/feed/'],
  mountains: ['https://wspinanie.pl/feed', 'https://www.explorersweb.com/feed/', 'https://www.alpinist.com/feed/'],
  sport: ['https://www.przegladsportowy.pl/.feed'],
  culture: ['https://kultura.onet.pl/.feed'],
  business: ['https://www.money.pl/rss/', 'https://www.bankier.pl/rss/wiadomosci.xml'],
};

/**
 * Kanały tematyczne: prawie wszystko, co publikują, dotyczy danego węzła (np. Chess.com → szachy).
 * Ich pozycje dostają mały bonus trafności dla tego węzła i jego przodków. Portale ogólne
 * (Antyweb, Chip, Spider’s Web — także AGD, motocykle, nauka) celowo bonusu nie dostają.
 */
export const DEDICATED_FEEDS: Record<string, string> = {
  'https://en.chessbase.com/feed': 'games.chess',
  'https://www.chess.com/rss/news': 'games.chess',
  'https://electrek.co/guides/tesla/feed/': 'auto.ev.tesla',
  'https://huggingface.co/blog/feed.xml': 'tech.ai',
  'https://www.marktechpost.com/feed/': 'tech.ai',
  'https://wspinanie.pl/feed': 'mountains.climbing',
};

/**
 * Dowody słowne dla szczegółowych zainteresowań. Wektor e5 na krótkim tekście nie odróżnia „newsa
 * o gadżecie” od „newsa o hackathonie” (przypisanie ~66/103 poprawnych). Liść z tej listy jest
 * przypisywany tylko, gdy tekst zawiera dowód albo treść pochodzi z kanału tematycznego tego węzła;
 * inaczej treść wraca do ogólniejszego zainteresowania lub trafia do puli „sąsiednich tematów”.
 * Na zbiorze 320 pozycji RSS: przypisanie 66 → 81/103, precyzja 0,91 → 0,95 (docs/implementation-plan.md).
 * Węzeł bez wpisu nie ma bramki. Listy rozwijamy na podstawie ocen użytkowników (engine export/eval).
 */
export const EVIDENCE: Record<string, RegExp> = {
  'tech.hackathons': /hack(a|e)?th?on|hackyeah|game ?jam|code ?jam|hacktoberfest|\bctf\b/i,
  'auto.ev.tesla': /tesl|cybertruck|cybercab|robotaxi|\bfsd\b|model [3ysx]\b|supercharger|gigafactory|giga (berlin|texas)/i,
  'tech.ai.agents.rag': /\brag\b|retriev|vector (database|store|search)|baz(a|y|ie|ach) wektor|embedding|wyszukiwani[ae] semantyczn/i,
  'tech.ai.agents': /agent|agentic|\bmcp\b|function calling|tool[- ]use|computer[- ]use/i,
  'tech.ai':
    /\bai\b|\bsi\b|sztuczn|\bllm|\bgpt|chatbot|chatgpt|machine learning|uczeni[ae] maszynow|neural|sieci neuronow|openai|anthropic|claude|gemini|mistral|qwen|deepseek|hugging ?face|transformer|model(e|u|i|em)? (językow|ai|jęz)|diffusion|multimodal|\basr\b|\btts\b/i,
  'games.chess':
    /szach|chess|arcymistrz|grandmaster|\bgm\b|fide|carlsen|nakamura|gukesh|caruana|blitz|bullet|olympiad|olimpiad|titled tuesday|lichess|freestyle/i,
  'mountains.ranges.alps':
    // Bez „alpine”/„alpinist” — to styl wspinaczki i nazwa magazynu, nie Alpy.
    /\balp(y|ach|ami|om|ejsk\w*)\b|\balps\b|\balpen\w*|mont blanc|matterhorn|dolomit|eiger|chamonix|zermatt|grossglockner|sassolungo|hochvogel|wendenst/i,
};

export const QUERIES: Record<string, PlannedQuery[]> = {
  'tech.ai': [pl('sztuczna inteligencja nowy model'), en('AI model release')],
  'tech.ai.agents': [pl('agenci AI'), en('AI agents')],
  'tech.ai.agents.rag': [en('RAG retrieval-augmented generation'), en('vector database retrieval LLM')],
  'tech.ai.agents.tools': [en('LLM function calling tools MCP')],
  'tech.ai.agents.multi': [en('multi-agent systems LLM')],
  'tech.ai.llm': [en('large language model release'), pl('model językowy LLM')],
  'tech.ai.vision': [en('computer vision model')],
  'tech.ai.ethics': [pl('AI Act regulacje sztucznej inteligencji'), en('AI regulation safety')],
  'tech.dev': [en('software development programming language release')],
  'tech.dev.web': [en('web development frontend framework')],
  'tech.dev.backend': [en('cloud backend infrastructure developers')],
  'tech.dev.mobile': [en('mobile app development iOS Android developers')],
  'tech.dev.oss': [en('open source project release')],
  'tech.security': [pl('cyberbezpieczeństwo atak hakerów'), en('cybersecurity vulnerability')],
  'tech.hackathons': [pl('hackathon zapisy'), en('hackathon 2026 registration')],
  'tech.gadgets': [pl('smartfon premiera test'), en('new gadget review')],
  'tech.startups': [pl('startup technologiczny finansowanie'), en('tech startup funding round')],
  'science.space': [pl('kosmos astronomia odkrycie'), en('space mission astronomy discovery')],
  'science.physics': [en('physics research breakthrough')],
  'science.biology': [en('biology genetics study')],
  'science.medicine': [pl('medycyna badanie naukowe'), en('medical research study')],
  'science.math': [en('mathematics proof breakthrough')],
  'science.psychology': [en('neuroscience psychology study')],
  'mountains.ranges.alps': [pl('Alpy góry wspinaczka'), en('Alps mountaineering')],
  'mountains.ranges.tatras': [pl('Tatry szlaki TOPR')],
  'mountains.ranges.beskids': [pl('Beskidy szlak')],
  'mountains.ranges.himalaya': [en('Himalaya expedition summit')],
  'mountains.hiking': [pl('trekking szlak górski'), en('hiking trail trekking')],
  'mountains.climbing': [pl('wspinaczka droga przejście'), en('rock climbing ascent')],
  'mountains.ski': [pl('skitury narciarstwo sezon'), en('ski touring season')],
  'travel.europe': [pl('podróże Europa'), en('Europe travel guide')],
  'travel.asia': [pl('podróże Azja'), en('Asia travel guide')],
  'travel.citybreak': [pl('city break weekend miasto')],
  'travel.budget': [pl('tanie loty podróże')],
  'sport.football': [pl('Ekstraklasa reprezentacja piłka nożna')],
  'sport.running': [pl('bieganie maraton')],
  'sport.cycling': [pl('kolarstwo wyścig')],
  'sport.volleyball': [pl('siatkówka reprezentacja')],
  'sport.f1': [pl('Formuła 1 wyścig'), en('Formula 1 Grand Prix')],
  'sport.fitness': [pl('trening siłownia fitness')],
  dance: [pl('taniec warsztaty')],
  'dance.ballroom': [pl('taniec towarzyski turniej'), en('ballroom dancing competition')],
  'dance.ballroom.standard': [pl('taniec towarzyski standard walc tango')],
  'dance.ballroom.latin': [pl('taniec latynoamerykański turniej')],
  'dance.salsa': [pl('salsa bachata potańcówka')],
  'dance.swing': [pl('swing lindy hop')],
  'dance.contemporary': [pl('taniec współczesny spektakl')],
  'games.chess': [pl('szachy turniej'), en('chess tournament grandmaster')],
  'games.chess.tournaments': [en('chess championship round grandmaster')],
  'games.chess.openings': [en('chess opening theory')],
  'games.chess.online': [en('online chess Chess.com Lichess')],
  'games.board': [pl('gry planszowe nowości'), en('board game release')],
  'games.video': [pl('gry wideo premiera recenzja'), en('video game release review')],
  'games.esport': [pl('e-sport turniej'), en('esports tournament')],
  'music.concerts': [pl('koncert festiwal ogłoszenie')],
  'music.electronic': [en('electronic music release')],
  'music.jazz': [pl('jazz koncert płyta')],
  'music.classical': [pl('muzyka klasyczna koncert filharmonia')],
  'music.rock': [pl('rock metal koncert płyta')],
  'music.hiphop': [pl('hip-hop rap płyta')],
  'culture.film': [pl('film premiera kino recenzja')],
  'culture.theatre': [pl('teatr premiera spektakl')],
  'culture.books': [pl('książka premiera literatura')],
  'culture.art': [pl('wystawa sztuki muzeum')],
  'culture.photo': [pl('fotografia wystawa konkurs')],
  'culture.history': [pl('historia odkrycie archeologia')],
  'business.startups': [pl('startup inwestycja runda')],
  'business.markets': [pl('gospodarka rynki inflacja')],
  'business.career': [pl('rynek pracy kariera')],
  'business.marketing': [pl('marketing kampania')],
  'auto.ev': [pl('samochody elektryczne'), en('electric vehicles EV')],
  'auto.ev.tesla': [pl('Tesla samochody'), en('Tesla Model Y Cybercab FSD')],
  'auto.ev.charging': [pl('ładowarki samochodów elektrycznych')],
  'auto.ev.batteries': [en('EV battery technology')],
  'auto.new': [pl('nowy model samochodu test')],
  'auto.classic': [pl('klasyczne samochody youngtimer')],
  'food.cooking': [pl('przepis gotowanie')],
  'food.coffee': [pl('kawa kawiarnia specialty')],
  'food.vege': [pl('kuchnia roślinna wegańska')],
  'food.restaurants': [pl('restauracja otwarcie')],
  'nature.climate': [pl('klimat energia odnawialna'), en('climate energy transition')],
  'nature.animals': [pl('zwierzęta przyroda')],
  'nature.ecology': [pl('ekologia zrównoważony rozwój')],
};

/** Kanały dla węzła: własne i odziedziczone po przodkach. */
export function feedsFor(nodeKey: string | null): string[] {
  if (!nodeKey) return [];
  const indexed = getNode(nodeKey);
  const ids = indexed ? indexed.path : [nodeKey];
  return [...new Set(ids.flatMap((id) => FEEDS[id] ?? []))];
}

/**
 * Zapytania dla tematu. Węzeł taksonomii → ręcznie dobrane frazy.
 * Własna etykieta spoza taksonomii → etykieta z kontekstem nadrzędnej kategorii (np. „Kitesurfing Sport”).
 */
export function queriesFor(topic: { label: string; path: string[]; node_key: string | null }): PlannedQuery[] {
  if (topic.node_key) return QUERIES[topic.node_key] ?? [];
  const context = topic.path.length > 1 ? topic.path[0] : '';
  return [pl(`${topic.label} ${context}`.trim())];
}
