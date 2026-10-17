/**
 * Narzędzia deweloperskie silnika (bez serwera):
 *
 *   npm run engine -- run [--search]            odkrywanie teraz: kanały (+ wyszukiwarka, jeśli --search)
 *   npm run engine -- inspect <email> [--all]   ranking trafności dla konta, z uzasadnieniem
 *   npm run engine -- export <email>            CSV do ręcznego oznaczenia (.cache/relevance/*.csv)
 *   npm run engine -- eval <plik.csv>           AUC i precyzja/czułość dla progów na oznaczonym CSV
 *   npm run engine -- usage                     zużycie zapytań Brave (dziś / miesiąc)
 *   npm run engine -- events <miasto> [--search] [--places]   wydarzenia ze stron organizatorów (+ wyszukiwarka, OSM)
 *
 * CSV zawiera wyłącznie dane z kanałów RSS i stron wydawców (nie wyniki wyszukiwarki — regulamin Brave).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, pool } from '../db.ts';
import { env } from '../env.ts';
import { closeEngine } from '../engine/context.ts';
import { extractContent, ingestFeed, searchTopic, syncTopics } from '../engine/discovery.ts';
import { scoreForUser } from '../engine/personal.ts';
import { feedsFor, queriesFor } from '../engine/sources.ts';
import { usageSummary } from '../engine/usage.ts';
import { getEmbeddingProvider, getSummaryProvider } from '../providers.ts';
import { latestSummary, summarizeContent } from '../engine/summaries.ts';
import { llmSummary } from '../engine/llm-budget.ts';
import { fillDailyPool } from '../engine/pool.ts';
import { syncInterestEmbeddings } from '../services/embeddings.ts';
import { getEventExtractor } from '../providers.ts';
import { ingestEventSource, ingestPlaces, searchEvents } from '../engine/events.ts';
import { eventSourcesFor } from '../engine/event-sources.ts';

async function eventsCmd() {
  const city = args.find((a) => !a.startsWith('--'));
  if (!city) throw new Error('Podaj miasto');
  await syncTopics(provider!);
  for (const s of eventSourcesFor(city)) {
    try {
      console.log(JSON.stringify(await ingestEventSource(s.url, city, provider!, getEventExtractor())));
    } catch (e) {
      console.log(`✘ ${s.url}: ${(e as Error).message}`);
    }
  }
  if (args.includes('--search')) console.log(JSON.stringify(await searchEvents(city, provider!, getEventExtractor())));
  if (args.includes('--places')) console.log(JSON.stringify(await ingestPlaces(city, provider!)));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const [cmd, ...args] = process.argv.slice(2);
const provider = getEmbeddingProvider();
if (!provider) throw new Error('EMBEDDING_PROVIDER=disabled — silnik wymaga embeddingów');

async function userByEmail(email: string | undefined) {
  if (!email) throw new Error('Podaj e-mail konta');
  const u = await db.selectFrom('user').select(['id', 'email']).where('email', '=', email.toLowerCase()).executeTakeFirst();
  if (!u) throw new Error(`Nie ma konta ${email}`);
  await syncInterestEmbeddings(u.id, provider!);
  return u;
}

const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(3);

async function run() {
  const keys = await syncTopics(provider!);
  const topics = await db.selectFrom('topic').selectAll().where('key', 'in', keys.length ? keys : ['']).execute();
  const feeds = [...new Set(topics.flatMap((t) => feedsFor(t.node_key)))];
  console.log(`Tematy: ${keys.length}, kanały: ${feeds.length}`);
  for (const f of feeds) {
    try {
      console.log(JSON.stringify(await ingestFeed(f, provider!)));
    } catch (e) {
      console.log(`✘ ${f}: ${(e as Error).message}`);
    }
  }
  const pending = await db.selectFrom('content_item').select('id').where('status', '=', 'discovered').execute();
  console.log(`Pobieranie stron: ${pending.length}`);
  let done = 0;
  for (const p of pending) {
    try {
      await extractContent(p.id, provider!);
    } catch (e) {
      console.log(`✘ ${p.id}: ${(e as Error).message}`);
    }
    if (++done % 10 === 0) console.log(`  ${done}/${pending.length}`);
  }
  if (args.includes('--search')) {
    for (const t of topics.filter((t) => queriesFor(t).length)) {
      console.log(JSON.stringify(await searchTopic(t.key, provider!)));
    }
  }
}

async function inspect() {
  const u = await userByEmail(args[0]);
  const { interests, items } = await scoreForUser(u.id, provider!, { includeIrrelevant: args.includes('--all') });
  console.log(`Zainteresowania (${interests.length}): ${interests.map((i) => i.label).join(', ')}`);
  const T = env.RELEVANCE_THRESHOLD;
  const matched = items.filter((i) => i.relevance.margin >= T);
  const adjacent = items.filter((i) => i.relevance.margin < T && i.relevance.looseMargin >= T);
  console.log(`Treści: ${items.length} · dopasowane (z dowodem): ${matched.length} · sąsiednie (odkrywanie): ${adjacent.length}\n`);
  const byInterest = new Map<string, number>();
  for (const i of matched) byInterest.set(i.relevance.interestLabel!, (byInterest.get(i.relevance.interestLabel!) ?? 0) + 1);
  console.log('Dopasowane wg zainteresowania:', [...byInterest].map(([k, v]) => `${k} ${v}`).join(' · '), '\n');
  for (const i of items) {
    const r = i.relevance;
    const mark = r.margin >= T ? '✔' : r.looseMargin >= T ? '~' : '·';
    const prior = r.prior ? ` +źródło ${r.prior}` : '';
    const why = r.interestLabel
      ? `→ ${r.interestLabel} (${r.similarity.toFixed(3)}${prior}) vs „${r.rival.slice(0, 24)}” (${r.rivalSimilarity.toFixed(3)})`
      : '→ brak dowodu dla żadnego zainteresowania';
    console.log(`${mark} ${fmt(Number.isFinite(r.margin) ? r.margin : r.looseMargin)}  ${i.title.slice(0, 70).padEnd(70)}  ${why}  [${i.sourceDomain}]`);
  }
}

/** summarize <contentId…> — streszcza wskazane treści i wypisuje wynik. */
async function summarizeCmd() {
  if (!args.length) throw new Error('Podaj identyfikatory treści');
  for (const id of args) {
    const out = await summarizeContent(id, getSummaryProvider());
    const s = await latestSummary(id);
    const item = await db.selectFrom('content_item').select(['title', 'url']).where('id', '=', id).executeTakeFirst();
    console.log(`\n=== ${item?.title} (${out.status})\n${item?.url}`);
    if (s) {
      console.log(`Karta: ${s.card_description}\nPodstawa: ${s.basis} · tagi: ${s.tags.join(', ')} · tokeny ${s.input_tokens}/${s.output_tokens}\n\n${s.summary}`);
      if (s.key_facts.length) console.log('\nFakty:\n- ' + s.key_facts.join('\n- '));
      if (s.caveats.length) console.log('Zastrzeżenia:\n- ' + s.caveats.join('\n- '));
    }
  }
  console.log('\nZużycie LLM:', await llmSummary());
}

/** pool <email> [--force] — buduje/uzupełnia dzisiejszą pulę i wypisuje ją z uzasadnieniem. */
async function poolCmd() {
  const u = await userByEmail(args[0]);
  console.log(JSON.stringify(await fillDailyPool(u.id, provider!, { force: args.includes('--force') })));
  const rows = await db
    .selectFrom('daily_assignment as a')
    .innerJoin('content_item as c', 'c.id', 'a.content_id')
    .select(['a.slot', 'a.kind', 'a.score', 'a.reason', 'c.title', 'c.source_domain', 'c.published_at'])
    .where('a.user_id', '=', u.id)
    .orderBy('a.local_day', 'desc')
    .orderBy('a.slot')
    .limit(20)
    .execute();
  for (const r of rows) {
    const p = r.reason.parts;
    console.log(`${String(r.slot).padStart(2)} ${r.kind === 'explore' ? '🧭' : '✔'} ${r.score.toFixed(3)}  ${r.title.slice(0, 64).padEnd(64)}  ${(r.reason.interest ?? '').slice(0, 22).padEnd(22)} [${r.source_domain}] i${p.interest} t${p.tag} f${p.freshness} q${p.quality} n${p.novelty ?? '-'}`);
  }
}

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function exportCsv() {
  const u = await userByEmail(args[0]);
  const { items } = await scoreForUser(u.id, provider!, { includeIrrelevant: true });
  const dir = path.join(root, '.cache', 'relevance');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${u.id.slice(0, 6)}.csv`);
  const lines = ['ocena;margines;zainteresowanie;tytul;zrodlo;url;id'];
  for (const i of items) {
    lines.push(['', (Number.isFinite(i.relevance.margin) ? i.relevance.margin : i.relevance.looseMargin).toFixed(4), csvCell(i.relevance.interestLabel ?? ''), csvCell(i.title), i.sourceDomain, csvCell(i.url), i.id].join(';'));
  }
  await writeFile(file, '﻿' + lines.join('\n'), 'utf8');
  console.log(`Zapisano ${items.length} pozycji: ${file}`);
  console.log('Wpisz w kolumnie „ocena”: 2 = wyraźnie dla mnie, 1 = może być, 0 = nie dla mnie. Potem: npm run engine -- eval <plik>');
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ';') cells.push(cur), (cur = '');
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

async function evaluate() {
  const file = args[0];
  if (!file) throw new Error('Podaj plik CSV');
  const rows = parseCsv(await readFile(file, 'utf8'))
    .map((c) => ({ label: c[0]?.trim(), margin: Number(c[1]) }))
    .filter((r) => r.label !== '' && r.label !== undefined && Number.isFinite(r.margin))
    .map((r) => ({ y: Number(r.label), s: r.margin }));
  if (!rows.length) throw new Error('Brak oznaczonych wierszy (kolumna „ocena”)');
  const pos = rows.filter((r) => r.y >= 1).map((r) => r.s);
  const neg = rows.filter((r) => r.y === 0).map((r) => r.s);
  let w = 0;
  for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
  console.log(`Oznaczonych: ${rows.length} (trafne ≥1: ${pos.length}, nietrafne: ${neg.length}); AUC ${pos.length && neg.length ? (w / (pos.length * neg.length)).toFixed(3) : '—'}`);
  for (const t of [-0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02, 0.03]) {
    const sel = rows.filter((r) => r.s >= t);
    const tp = sel.filter((r) => r.y >= 1).length;
    console.log(`  próg ${fmt(t)}: wybrano ${String(sel.length).padStart(3)}, precyzja ${sel.length ? (tp / sel.length).toFixed(2) : '—'}, czułość ${pos.length ? (tp / pos.length).toFixed(2) : '—'}`);
  }
}

try {
  if (cmd === 'run') await run();
  else if (cmd === 'inspect') await inspect();
  else if (cmd === 'export') await exportCsv();
  else if (cmd === 'eval') await evaluate();
  else if (cmd === 'summarize') await summarizeCmd();
  else if (cmd === 'pool') await poolCmd();
  else if (cmd === 'events') await eventsCmd();
  else if (cmd === 'usage') {
    console.log('Brave:', await usageSummary('brave'), `limity: ${env.BRAVE_DAILY_QUERY_LIMIT}/dzień, ${env.BRAVE_MONTHLY_QUERY_LIMIT}/mies.`);
    console.log('LLM (szacunek USD):', await llmSummary(), `limity: ${env.LLM_DAILY_BUDGET_USD}/dzień, ${env.LLM_MONTHLY_BUDGET_USD}/mies.`);
  }
  else console.log('Użycie: npm run engine -- run [--search] | inspect <email> [--all] | export <email> | eval <plik.csv> | summarize <id…> | pool <email> [--force] | usage');
} finally {
  await closeEngine();
  await pool.end();
}
