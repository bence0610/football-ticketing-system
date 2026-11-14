/**
 * "janos.kovacs@gmail.hu" -> "j***@g***.hu". Used where an address is shown to
 * someone who may not be its owner (the notice sent to the old address), so a
 * stranger reading that mailbox learns only enough for the owner to recognise it.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) {
    return '***';
  }
  const local = email.slice(0, at);
  const labels = email.slice(at + 1).split('.');
  const tld = labels.length > 1 ? labels.pop()! : '';
  const host = labels.join('.');
  return `${local[0]}***@${host[0] ?? ''}***${tld ? `.${tld}` : ''}`;
}
