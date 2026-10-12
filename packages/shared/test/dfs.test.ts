import { describe, expect, it } from 'vitest';
import {
  DfsError,
  answerDfs,
  backDfs,
  createDfsState,
  currentQuestion,
  dfsSelections,
  enoughDfs,
  skipDfs,
  startDfs,
  type DfsState,
} from '../src/index.ts';

const keys = (s: DfsState) => dfsSelections(s).map((x) => x.key);

describe('DFS onboardingu', () => {
  it('pogłębia pierwszą wybraną gałąź do końca, potem rodzeństwo, potem kolejną kategorię główną', () => {
    let s = startDfs(createDfsState(), ['tech', 'mountains']);
    expect(currentQuestion(s)?.key).toBe('tech');

    s = answerDfs(s, ['tech.ai', 'tech.hackathons']);
    expect(currentQuestion(s)?.key).toBe('tech.ai'); // hackathony to liść, czekają pod spodem

    s = answerDfs(s, ['tech.ai.agents', 'tech.ai.llm']);
    expect(currentQuestion(s)?.key).toBe('tech.ai.agents');

    s = answerDfs(s, ['tech.ai.agents.rag']);
    // RAG to liść, LLM to liść, hackathony to liść → następna kategoria główna
    expect(currentQuestion(s)?.key).toBe('mountains');

    s = answerDfs(s, ['mountains.ranges']);
    expect(currentQuestion(s)?.key).toBe('mountains.ranges');
    s = answerDfs(s, ['mountains.ranges.alps']);

    expect(s.done).toBe(true);
    expect(keys(s)).toEqual([
      'tech', 'mountains', 'tech.ai', 'tech.hackathons', 'tech.ai.agents', 'tech.ai.llm',
      'tech.ai.agents.rag', 'mountains.ranges', 'mountains.ranges.alps',
    ]);
    // Zachowane są zarówno ogólne zainteresowanie, jak i szczegółowy liść.
    const rag = dfsSelections(s).find((x) => x.key === 'tech.ai.agents.rag')!;
    expect(rag.path).toEqual(['Informatyka i technologia', 'Sztuczna inteligencja', 'Agenci AI', 'RAG']);
  });

  it('„Pomiń” zamyka tylko bieżącą gałąź', () => {
    let s = startDfs(createDfsState(), ['games', 'dance']);
    s = skipDfs(s);
    expect(currentQuestion(s)?.key).toBe('dance');
    expect(keys(s)).toEqual(['games', 'dance']);
  });

  it('„Wystarczy” kończy cały etap, zachowując dotychczasowe wybory', () => {
    let s = startDfs(createDfsState(), ['games', 'dance']);
    s = answerDfs(s, ['games.chess']);
    s = enoughDfs(s);
    expect(s.done).toBe(true);
    expect(currentQuestion(s)).toBeNull();
    expect(keys(s)).toEqual(['games', 'dance', 'games.chess']);
  });

  it('„Wstecz” przywraca poprzednie pytanie i wybory', () => {
    let s = startDfs(createDfsState(), ['games']);
    s = answerDfs(s, ['games.chess']);
    expect(currentQuestion(s)?.key).toBe('games.chess');
    s = backDfs(s);
    expect(currentQuestion(s)?.key).toBe('games');
    expect(keys(s)).toEqual(['games']);
  });

  it('respektuje maksymalną głębokość', () => {
    let s = startDfs(createDfsState(2), ['tech']);
    s = answerDfs(s, ['tech.ai']);
    s = answerDfs(s, ['tech.ai.agents']);
    // tech.ai.agents ma głębokość 2 = limit → nie pytamy o RAG
    expect(s.done).toBe(true);
  });

  it('odrzuca opcje spoza pytania i nie tworzy cykli z własnego tekstu', () => {
    let s = startDfs(createDfsState(), ['tech']);
    expect(() => answerDfs(s, ['games.chess'])).toThrow(DfsError);
    s = answerDfs(s, ['tech.ai']);
    // Wpisanie przodka („Informatyka”) jako dziecka jest ignorowane.
    s = answerDfs(s, [], [{ label: 'Informatyka' }]);
    expect(keys(s)).toEqual(['tech', 'tech.ai']);
  });

  it('deduplikuje synonimy i własne etykiety', () => {
    let s = startDfs(createDfsState(), ['games'], [{ label: 'Szachy' }, { label: 'szachy ' }]);
    expect(keys(s)).toEqual(['games', 'games.chess']);
    expect(() => answerDfs(s, ['games.chess'])).toThrow(DfsError); // już wybrane → nie jest opcją
  });

  it('zachowuje własną etykietę, której nie ma w taksonomii, i nie zapętla pytań', () => {
    let s = startDfs(createDfsState(), [], [{ label: 'Szydełkowanie' }]);
    expect(s.done).toBe(true); // brak znanych podkategorii → bez pytania
    const sel = dfsSelections(s)[0]!;
    expect(sel).toMatchObject({ label: 'Szydełkowanie', source: 'custom', nodeId: null });
  });

  it('wymaga doprecyzowania wieloznacznego hasła', () => {
    const s = createDfsState();
    try {
      startDfs(s, [], [{ label: 'Tesla' }]);
      expect.unreachable();
    } catch (e) {
      expect((e as DfsError).code).toBe('AMBIGUOUS');
      expect((e as DfsError).senses?.senses.map((x) => x.label)).toContain('Nikola Tesla');
    }
    const car = startDfs(s, [], [{ label: 'Tesla', sense: 'Tesla (samochody)' }]);
    expect(dfsSelections(car)[0]).toMatchObject({ nodeId: 'auto.ev.tesla', source: 'taxonomy' });
    const inventor = startDfs(s, [], [{ label: 'Tesla', sense: 'Nikola Tesla' }]);
    expect(dfsSelections(inventor)[0]).toMatchObject({ label: 'Nikola Tesla', source: 'custom' });
  });

  it('stan jest serializowalny i pozwala wznowić onboarding', () => {
    let s = startDfs(createDfsState(), ['tech', 'dance']);
    s = answerDfs(s, ['tech.ai']);
    const restored = JSON.parse(JSON.stringify(s)) as DfsState;
    expect(currentQuestion(restored)?.key).toBe('tech.ai');
    const next = skipDfs(restored);
    expect(currentQuestion(next)?.key).toBe('dance');
  });

  it('wymaga co najmniej jednego zainteresowania', () => {
    expect(() => startDfs(createDfsState(), [])).toThrow(DfsError);
  });
});
