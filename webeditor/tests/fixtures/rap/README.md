# Фікстури raP (T7) — ліцензійно чисті

Жодного чужого config.bin тут НЕМАЄ і бути не може: закомічений бінаризований конфіг
чужого мода — це редистрибуція мода (ліцензії модпаку цього не дозволяють). Уся золота
пара — НАШ ВЛАСНИЙ контент:

- `zp_research.config.cpp` — знімок `E:\dayzmod\ZP_Research\config.cpp` (наш мод) на
  момент створення фікстури.
- `zp_research.config.bin` — він же, бінаризований офіційним інструментом:
  `CfgConvert.exe -bin -dst zp_research.config.bin zp_research.config.cpp`.
- `zp_research.config.roundtrip.cpp` — раундтрип бінарника назад у текст:
  `CfgConvert.exe -txt -dst zp_research.config.roundtrip.cpp zp_research.config.bin`.

Тест `tests/rap.test.ts` вимагає ІДЕНТИЧНИХ дефініцій від трьох шляхів розбору
(raP-парсер по bin, текстовий парсер по раундтрипу, текстовий парсер по рукописному
cpp). Паритет із РЕАЛЬНИМИ чужими модами перевіряється окремо локальним
`tests/importParity.test.ts` (skipIf без теки гри) — читає моди з диска, у git нічого
чужого не потрапляє.

Знімок НЕ оновлюється автоматично слідом за живим config.cpp — це і не потрібно
(тест перевіряє парсери, не актуальність мода). Перегенерація за бажанням:
```
Copy-Item E:\dayzmod\ZP_Research\config.cpp zp_research.config.cpp
& "E:\Programs\Steam\steamapps\common\DayZ Tools\Bin\CfgConvert\CfgConvert.exe" -bin -dst zp_research.config.bin zp_research.config.cpp
& "E:\Programs\Steam\steamapps\common\DayZ Tools\Bin\CfgConvert\CfgConvert.exe" -txt -dst zp_research.config.roundtrip.cpp zp_research.config.bin
```
