import { TAXONOMY_INDEX } from './taxonomy.ts';

/**
 * Normalizacja etykiety do porównań i deduplikacji tagów:
 * małe litery, bez polskich znaków diakrytycznych, bez interpunkcji, pojedyncze spacje.
 * Oryginalna etykieta zawsze jest przechowywana osobno.
 */
export function normalizeTag(label: string): string {
  return label
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Słownik: znormalizowana etykieta lub synonim → ID węzła taksonomii. */
const SYNONYM_INDEX: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const { node } of TAXONOMY_INDEX.values()) {
    for (const s of [node.label, ...(node.synonyms ?? [])]) {
      const key = normalizeTag(s);
      if (!map.has(key)) map.set(key, node.id);
    }
  }
  return map;
})();

/** Dopasowanie własnego tekstu do istniejącego węzła (dokładne lub przez synonim). */
export function matchTaxonomy(label: string): string | undefined {
  return SYNONYM_INDEX.get(normalizeTag(label));
}

/**
 * Znane wieloznaczne hasła. Dla nich onboarding zadaje krótkie pytanie doprecyzowujące
 * zamiast zgadywać znaczenie. Rozwijanie nieznanych haseł przez AI dojdzie razem z silnikiem.
 */
export interface Sense {
  label: string;
  /** Węzeł taksonomii, jeśli znaczenie w niej istnieje. */
  nodeId?: string;
  hint: string;
}

const AMBIGUOUS: Record<string, Sense[]> = {
  tesla: [
    { label: 'Tesla (samochody)', nodeId: 'auto.ev.tesla', hint: 'Firma, samochody elektryczne, Elon Musk' },
    { label: 'Nikola Tesla', hint: 'Wynalazca, historia nauki' },
    { label: 'Tesla (jednostka)', hint: 'Jednostka indukcji magnetycznej w fizyce' },
  ],
  python: [
    { label: 'Python (język programowania)', hint: 'Programowanie, data science' },
    { label: 'Pyton (wąż)', hint: 'Zwierzęta, przyroda' },
  ],
  jaguar: [
    { label: 'Jaguar (samochody)', hint: 'Marka motoryzacyjna' },
    { label: 'Jaguar (zwierzę)', hint: 'Przyroda, dzikie koty' },
  ],
  apple: [
    { label: 'Apple (firma)', hint: 'iPhone, Mac, technologia' },
    { label: 'Jabłka', hint: 'Kulinaria, sadownictwo' },
  ],
  mars: [
    { label: 'Mars (planeta)', hint: 'Kosmos, misje marsjańskie' },
    { label: 'Mars (firma)', hint: 'Słodycze, przemysł spożywczy' },
  ],
  rust: [
    { label: 'Rust (język programowania)', hint: 'Programowanie systemowe' },
    { label: 'Rust (gra)', hint: 'Gry wideo, survival' },
  ],
};

export function findSenses(label: string): Sense[] | undefined {
  return AMBIGUOUS[normalizeTag(label)];
}
