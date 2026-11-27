/** Folds case and accents so a search for "dominio" finds "Domínio". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
