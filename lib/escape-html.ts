/** Escape teks yang berasal dari user sebelum disisipkan ke string HTML
 *  (dipakai LedgerWall yang merender lewat dangerouslySetInnerHTML). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
