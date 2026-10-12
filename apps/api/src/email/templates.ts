/** Proste, bezpieczne szablony e-maili konta (HTML + tekst). */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, intro: string, cta: { label: string; url: string }, footer: string): string {
  const url = escapeHtml(cta.url);
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F8FAFC;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;border:1px solid #E2E8F0;overflow:hidden">
        <tr><td style="height:6px;background:linear-gradient(90deg,#7C3AED,#2563EB)"></td></tr>
        <tr><td style="padding:32px">
          <p style="margin:0 0 4px;font-weight:700;font-size:20px;color:#7C3AED">ReadYou</p>
          <h1 style="margin:16px 0 8px;font-size:22px">${escapeHtml(title)}</h1>
          <p style="margin:0 0 24px;line-height:1.6;color:#334155">${escapeHtml(intro)}</p>
          <a href="${url}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#7C3AED;background-image:linear-gradient(90deg,#7C3AED,#2563EB);color:#FFFFFF;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#64748B">Jeśli przycisk nie działa, skopiuj adres:<br><span style="word-break:break-all">${url}</span></p>
          <p style="margin:16px 0 0;font-size:13px;color:#64748B">${escapeHtml(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function verificationEmail(name: string, url: string) {
  const title = 'Potwierdź swój adres e-mail';
  const intro = `Cześć${name ? ` ${name}` : ''}! Potwierdź adres, aby móc otrzymywać piątkowy raport ReadYou.`;
  const footer = 'Jeśli to nie Ty, zignoruj tę wiadomość — konto nie zostanie aktywowane do raportów.';
  return {
    subject: 'ReadYou — potwierdź adres e-mail',
    html: layout(title, intro, { label: 'Potwierdź e-mail', url }, footer),
    text: `${title}\n\n${intro}\n\n${url}\n\n${footer}`,
  };
}

export function resetPasswordEmail(url: string) {
  const title = 'Ustaw nowe hasło';
  const intro = 'Otrzymaliśmy prośbę o reset hasła do konta ReadYou. Link jest ważny przez ograniczony czas.';
  const footer = 'Jeśli to nie Ty, zignoruj tę wiadomość — hasło pozostanie bez zmian.';
  return {
    subject: 'ReadYou — reset hasła',
    html: layout(title, intro, { label: 'Ustaw nowe hasło', url }, footer),
    text: `${title}\n\n${intro}\n\n${url}\n\n${footer}`,
  };
}
