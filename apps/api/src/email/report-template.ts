/** E-mail raportu tygodniowego: HTML (tabele, style inline — klienci poczty) i wersja tekstowa. */
import type { ReportContent, ReportItem } from '@readyou/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtWhen = (iso: string, tz: string, allDay = false) =>
  new Date(iso).toLocaleString('pl-PL', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'long', ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }) });

const SECTIONS: { key: ReportItem['section']; title: string }[] = [
  { key: 'news', title: 'Najważniejsze z tygodnia' },
  { key: 'events', title: 'Wydarzenia na najbliższe 7 dni' },
  { key: 'deadlines', title: 'Terminy zapisów' },
];

export interface ReportLinks {
  appUrl: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  /** Strefa osoby — terminy wydarzeń w jej czasie lokalnym. */
  timezone: string;
}

function itemHtml(i: ReportItem, index: number, tz: string) {
  const meta = [i.source, i.when ? (i.section === 'deadlines' ? `zapisy do ${fmtWhen(i.when, tz)}` : i.ongoing ? `trwa do ${fmtWhen(i.when, tz, true)}` : fmtWhen(i.when, tz, i.allDay)) : null].filter(Boolean).join(' · ');
  return `<tr><td style="padding:14px 0;border-top:1px solid #E2E8F0">
    <p style="margin:0 0 2px;font-size:12px;color:#7C3AED;font-weight:600">${index}. ${esc(i.why)}</p>
    <a href="${esc(i.url)}" style="font-size:17px;font-weight:700;color:#0F172A;text-decoration:none;line-height:1.35">${esc(i.title)}</a>
    ${i.description ? `<p style="margin:6px 0 0;font-size:15px;line-height:1.55;color:#334155">${esc(i.description)}</p>` : ''}
    <p style="margin:6px 0 0;font-size:13px;color:#64748B">${esc(meta)} · <a href="${esc(i.url)}" style="color:#2563EB">źródło</a></p>
  </td></tr>`;
}

export function reportEmail(c: ReportContent, links: ReportLinks) {
  const subject = `ReadYou — Twój tydzień (${c.periodLabel})`;
  const number = new Map(c.items.map((it, n) => [it.contentId, n + 1]));
  const sectionsHtml = SECTIONS.map(({ key, title }) => {
    const items = c.items.filter((i) => i.section === key);
    if (!items.length) return '';
    return `<tr><td style="padding:24px 0 4px"><h2 style="margin:0;font-size:18px;color:#0F172A">${title}</h2></td></tr>${items.map((i) => itemHtml(i, number.get(i.contentId)!, links.timezone)).join('')}`;
  }).join('');
  const changesHtml = c.changes.length
    ? `<tr><td style="padding:20px 0 0"><h2 style="margin:0 0 6px;font-size:18px;color:#0F172A">Co się zmieniło</h2>
        <ul style="margin:0;padding-left:20px;color:#334155;font-size:15px;line-height:1.6">${c.changes
          .map((ch) => `<li>${esc(ch.text)} <span style="color:#64748B;font-size:13px">(${ch.itemIds.map((id) => `poz. ${number.get(id)}`).join(', ')})</span></li>`)
          .join('')}</ul>
        <p style="margin:6px 0 0;font-size:12px;color:#64748B">Synteza AI na podstawie streszczeń pozycji z tego raportu.</p></td></tr>`
    : '';
  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border-radius:20px;border:1px solid #E2E8F0;overflow:hidden">
        <tr><td style="height:6px;background:linear-gradient(90deg,#7C3AED,#2563EB)"></td></tr>
        <tr><td style="padding:28px 28px 8px">
          <p style="margin:0;font-weight:700;font-size:20px;color:#7C3AED">ReadYou</p>
          <h1 style="margin:12px 0 4px;font-size:24px;line-height:1.25">Twój tydzień</h1>
          <p style="margin:0;font-size:13px;color:#64748B">${esc(c.periodLabel)}</p>
          <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#334155">${esc(c.intro)}</p>
        </td></tr>
        <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${changesHtml}${sectionsHtml}</table></td></tr>
        <tr><td style="padding:24px 28px">
          <a href="${esc(links.appUrl)}/articles" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#7C3AED;background-image:linear-gradient(90deg,#7C3AED,#2563EB);color:#FFFFFF;text-decoration:none;font-weight:600">Otwórz ReadYou</a>
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-size:12px;line-height:1.6;color:#64748B">
          Ten raport jest włączony w Twoich ustawieniach ReadYou. Każda pozycja prowadzi do oryginalnego źródła.<br>
          <a href="${esc(links.settingsUrl)}" style="color:#64748B">Ustawienia raportu</a> · <a href="${esc(links.unsubscribeUrl)}" style="color:#64748B">Wypisz się</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const lines: string[] = [`ReadYou — Twój tydzień`, c.periodLabel, '', c.intro, ''];
  if (c.changes.length) {
    lines.push('CO SIĘ ZMIENIŁO', ...c.changes.map((ch) => `- ${ch.text} (${ch.itemIds.map((id) => `poz. ${number.get(id)}`).join(', ')})`), '(Synteza AI na podstawie streszczeń pozycji z tego raportu.)', '');
  }
  for (const { key, title } of SECTIONS) {
    const items = c.items.filter((i) => i.section === key);
    if (!items.length) continue;
    lines.push(title.toUpperCase());
    for (const i of items) {
      lines.push(`${number.get(i.contentId)}. ${i.title}`);
      if (i.description) lines.push(`   ${i.description}`);
      lines.push(`   ${[i.source, i.when ? (i.ongoing ? `trwa do ${fmtWhen(i.when, links.timezone, true)}` : fmtWhen(i.when, links.timezone, i.allDay)) : null].filter(Boolean).join(' · ')} — ${i.url}`, '');
    }
  }
  lines.push(`Otwórz ReadYou: ${links.appUrl}/articles`, `Ustawienia raportu: ${links.settingsUrl}`, `Wypisz się: ${links.unsubscribeUrl}`);
  return { subject, html, text: lines.join('\n') };
}
