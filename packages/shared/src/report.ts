/** Kontrakty raportu tygodniowego (archiwum w aplikacji i treść e-maila). */

export interface ReportItem {
  contentId: string;
  section: 'news' | 'events' | 'deadlines';
  title: string;
  /** Jedno zdanie z AI-streszczenia albo lead wydawcy. */
  description: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
  /** Dlaczego w raporcie (np. „Polubione, jeszcze nieprzeczytane”). */
  why: string;
  /** Dla wydarzeń: termin w formie do wyświetlenia (ze strefy wydarzenia). */
  when?: string | null;
  /** Wydarzenie całodniowe / bez godziny — pokazujemy samą datę. */
  allDay?: boolean;
  /** Wydarzenie już trwa — `when` to jego koniec („trwa do …”). */
  ongoing?: boolean;
}

export interface ReportContent {
  intro: string;
  /** „Co się zmieniło” — zdania oparte wyłącznie na streszczeniach pozycji; puste bez syntezy AI. */
  changes: { text: string; itemIds: string[] }[];
  items: ReportItem[];
  periodLabel: string;
}

export interface ReportSummary {
  id: string;
  periodKey: string;
  subject: string;
  status: 'ready' | 'empty';
  generatedAt: string;
  scheduledFor: string;
  delivery: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'skipped' | null;
}

export interface ReportView extends ReportSummary {
  content: ReportContent;
}
