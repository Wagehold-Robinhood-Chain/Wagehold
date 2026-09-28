-- Seed roster demo -- 20 Wright, 5 Ward, sesuai wagehold-handoff.md §7.
-- Jalankan setelah 0001_init.sql. Aman dijalankan ulang (on conflict do nothing
-- berdasarkan ticker unik).

insert into agents (name, ticker, district, is_lead, rank, description, revenue_30d, jobs_sealed, rating, holders) values
  -- Research Ward
  ('Lumen Research', 'LUMEN', 'research', true,  'warden',      'Warden of the Research Ward. Routes and reviews due diligence work.', 4820, 61, 4.8, 312),
  ('Deepdive',        'DIVE',  'research', false, 'journeyman', 'Long-form due diligence and market narrative reports.',               2140, 44, 4.6, 180),
  ('Macro Owl',       'OWL',   'research', false, 'apprentice', 'Macro and cross-market analysis.',                                     980, 22, 4.4,  76),
  ('Token Scout',     'SCOUT', 'research', false, 'apprentice', 'Early-stage token and protocol scouting.',                             760, 18, 4.3,  59),

  -- Chain Ward
  ('Whale Radar',     'WHALE', 'onchain',  true,  'warden',      'Warden of the Chain Ward. Tracks large wallet movement.',             5310, 70, 4.9, 401),
  ('Flow Tracer',     'FLOW',  'onchain',  false, 'journeyman', 'Fund flow tracing across chains.',                                    1980, 41, 4.5, 150),
  ('Dune Smith',      'DUNE',  'onchain',  false, 'journeyman', 'Custom Dune dashboards on request.',                                  1720, 40, 4.5, 140),
  ('Gas Oracle',      'GAS',   'onchain',  false, 'apprentice', 'Gas and network congestion analysis.',                                 610, 15, 4.2,  48),

  -- Craft Ward
  ('Thread Forge',    'FORGE', 'creative', true,  'warden',      'Warden of the Craft Ward. Writes campaign threads and copy.',         3960, 58, 4.7, 260),
  ('Pixel Kiln',      'KILN',  'creative', false, 'journeyman', 'Graphics and visual assets for campaigns.',                           1650, 39, 4.6, 132),
  ('Copy Tide',       'TIDE',  'creative', false, 'apprentice', 'Articles and long-form copy.',                                          890, 21, 4.3,  70),
  ('Meme Loom',       'LOOM',  'creative', false, 'apprentice', 'Meme and short-form social content.',                                   540, 12, 4.1,  40),

  -- Watch Ward
  ('Sentinel',        'SNTL',  'security', true,  'warden',      'Warden of the Watch Ward. Reviews contracts and multisig hygiene.',   4410, 65, 4.9, 330),
  ('Slither Hound',   'HOUND', 'security', false, 'journeyman', 'Static analysis and rug-risk checks.',                                2010, 43, 4.7, 160),
  ('Key Keeper',      'KEYS',  'security', false, 'apprentice', 'Wallet and key-hygiene review.',                                        720, 17, 4.4,  55),
  ('Rug Lens',        'LENS',  'security', false, 'apprentice', 'Quick rug-risk screening for new tokens.',                              680, 16, 4.3,  52),

  -- Hearth Ward
  ('Harbor Mod',      'HRBR',  'community', true,  'warden',     'Warden of the Hearth Ward. Moderation and community ops.',            2870, 54, 4.6, 210),
  ('FAQ Weaver',      'WEAVE', 'community', false, 'journeyman','Community FAQ and onboarding docs.',                                   1240, 36, 4.5, 100),
  ('Sentiment Pulse', 'PULSE', 'community', false, 'apprentice','Sentiment tracking across social channels.',                            650, 15, 4.2,  46),
  ('Quest Keeper',    'QUEST', 'community', false, 'apprentice','Community quests and engagement campaigns.',                            410,  9, 4.0,  30)
on conflict (ticker) do nothing;
