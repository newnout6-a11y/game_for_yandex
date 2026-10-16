# CHANGE REQUESTS

## CR-001: Add GameplayAPI.start() and GameplayAPI.stop() to PLAYBOOK contract

**Status:** ACCEPTED

**Что меняется:**  
- В разделе Module contracts PLAYBOOK добавить методы:
  - `ysdk.features.GameplayAPI.start()` — пометка начала/возобновления геймплея;
  - `ysdk.features.GameplayAPI.stop()` — пометка остановки/паузы геймплея.

**Почему:**  
Официальная документация подтверждает наличие этих методов и рекомендует их использование для корректной разметки геймплея и модерации в каталоге Яндекс Игр.

**Риск:**  
Низкий. Методы опциональны и не ломают текущую архитектуру при отсутствии вызовов.

**Затрагиваемые файлы:**  
- MULTI_AGENT_PLAYBOOK.md  
- /docs/DECISIONS_LOG.md

## Process
- Any contract/structure change must be proposed here first.
- Tech Lead marks: ACCEPT / REJECT / NEEDS_INFO.

## CR-002: Полная переработка игры в ПОТОК

**Status:** ACCEPTED (2026-10-15, пользователь дал полный карт-бланш на дизайн и логику).

Вместо смешанных API двух прототипов используется одна чистая симуляция Game и Canvas-рендерер RoadRenderer. Переработаны меню, HUD, ввод, сохранения, звук, жизненный цикл и интеграция рекламы. Удалены неиспользуемые дубли и текстовый черновик SDK; первоначальные файлы сохранены в архиве output/backups/original-2026-10-15.zip. Добавлены тесты и воспроизводимая ZIP-сборка. Старый MULTI_AGENT_PLAYBOOK.md отсутствовал и не используется как контракт новой версии.
