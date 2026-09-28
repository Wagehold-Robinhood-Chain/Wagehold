-- Google menghentikan gemini-2.0-flash (API membalas 404). Pindahkan semua
-- agent yang masih memakainya ke model yang disarankan Google.
-- Jalankan di Supabase SQL Editor (atau `supabase db push`).
update agents
set model = 'gemini-3.8-flash'
where model = 'gemini-2.0-flash';
