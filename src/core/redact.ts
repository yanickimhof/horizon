/**
 * Masquage local des identifiants sensibles, AVANT toute lecture par un modèle
 * ou stockage. Les montants et les dates sont conservés : ils sont l'objet de l'analyse.
 */
export type RedactionCounts = Partial<Record<'avs' | 'iban' | 'carte' | 'email' | 'tel' | 'numero' | 'naissance', number>>;

const luhn = (digits: string): boolean => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

export function redact(input: string): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  const bump = (k: keyof RedactionCounts) => (counts[k] = (counts[k] ?? 0) + 1);
  let text = input;

  text = text.replace(/\b756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}\b/g, () => (bump('avs'), '[AVS]'));
  text = text.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, () => (bump('iban'), '[IBAN]'));
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      bump('carte');
      return '[CARTE]';
    }
    return m;
  });
  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => (bump('email'), '[EMAIL]'));
  text = text.replace(/(?:\+41|0041|\b0)\s?\d{2}[\s.]?\d{3}[\s.]?\d{2}[\s.]?\d{2}\b/g, () => (bump('tel'), '[TEL]'));

  // Numéros de client, de sociétaire, de police ou de contrat: ils suivent « N° », « No » ou « Numéro ».
  text = text.replace(/\b((?:N°|No\.?|Nr\.?|Numéro)\s*(?:(?:de\s+)?[\p{L}]+[\s:]+)?:?\s*)([A-Z0-9][A-Z0-9.\-/]{5,})/giu, (m, label: string, num: string) => {
    if ((num.match(/\d/g) ?? []).length < 4) return m;
    bump('numero');
    return `${label}[NUMERO]`;
  });
  // Date de naissance: seule l'année est utile (âge, retraite).
  text = text.replace(/(naissance\s*:?\s*)(\d{1,2}[./]\d{1,2}[./])(\d{4})/gi, (_m, label: string, _dm: string, year: string) => {
    bump('naissance');
    return `${label}[JJ.MM.]${year}`;
  });
  return { text, counts };
}
