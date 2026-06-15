/**
 * Append a `(#pr)` reference to a changelog bullet, crediting the contributor
 * with `, thanks @author` when they are not in the maintainers set. GitHub
 * auto-links both the `#pr` and the `@author`.
 */
export function stampEntry(text: string, pr: number, author: string, maintainers: string[]): string {
  const credit = author.length > 0 && !maintainers.includes(author) ? `, thanks @${author}` : "";
  return `${text} (#${pr}${credit})`;
}
