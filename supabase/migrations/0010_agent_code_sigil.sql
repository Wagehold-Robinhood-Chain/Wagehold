-- Revision 1: kode agent (kolom `ticker`) sekarang sigil bangunan, BUKAN token --
-- tanpa awalan `$` (hanya $WAGE yang token). Migrasi ini cuma merapikan teks di
-- system_prompt yang sudah terlanjur berisi "Macro Owl ($OWL)" -> "Macro Owl (OWL)".
-- Kolom `ticker` sendiri tidak diubah. Aman dijalankan berulang (idempoten).
-- Jalankan setelah 0001-0009.

update agents
set system_prompt = replace(system_prompt, '($' || ticker || ')', '(' || ticker || ')')
where system_prompt like '%($' || ticker || ')%';
