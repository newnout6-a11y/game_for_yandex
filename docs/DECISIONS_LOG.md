# Decisions log

## 2026-01-17 — MVP skeleton + platform compliance

### SDK "Game Ready"
We call `ysdk.features.LoadingAPI.ready()` when the game is ready for user interaction and has no loading screens.
Sources:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
- https://yandex.com/dev/games/doc/en/sdk/sdk-game-events

### Pause/Resume events
We handle platform events `game_api_pause` and `game_api_resume` to freeze/resume gameplay for moderation compliance.
Sources:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-events
- https://yandex.com/dev/games/doc/en/sdk/sdk-events

### Ads APIs
Fullscreen ads use `ysdk.adv.showFullscreenAdv({callbacks})`. Rewarded uses `ysdk.adv.showRewardedVideo({callbacks})` with reward granted in `onRewarded`.
Source:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv

### Ads guardrails
Ads are refused when UI is PLAYING (no accidental clicks/fraud risk) and when lifecycle is already ADSHOWING (single-flight).
Sources:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv

### SDK GameplayAPI methods (optional) — ACCEPTED
Methods `ysdk.features.GameplayAPI.start()` and `ysdk.features.GameplayAPI.stop()` exist and can be used to mark gameplay start/stop for catalog metrics and moderation signals. Their usage is optional but recommended. We call them on UI state transitions (PLAYING enter/exit) when available.
Sources:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events
- https://yandex.com/dev/games/doc/en/requirements/1/19

### Lifecycle subscriptions (DOM + SDK)
Lifecycle is responsible for subscribing to:
- `document.visibilitychange`
- `window.blur/focus`
- `ysdk.on('game_api_pause'/'game_api_resume')`
and updating the mode `RUNNING|PAUSED|ADSHOWING`. Main loop updates world only when `lifecycle.isUpdatingAllowed()` is true.
Sources:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-events
- https://yandex.com/dev/games/doc/en/sdk/sdk-events

---

## Moderation notes (practical MUST / MUST NOT)

Based on official Yandex Games requirements and moderation guidelines.

### MUST
1. MUST integrate Yandex Games SDK for publication and monetization.
2. MUST call `LoadingAPI.ready()` after the game becomes interactive.
3. MUST keep the game playable if SDK, ads, or network are unavailable.
4. MUST pause gameplay on `visibilitychange`, `blur`, and `game_api_pause`.
5. MUST resume gameplay correctly on `focus` and `game_api_resume`.
6. MUST show fullscreen ads only in logical pauses (MENU, GAMEOVER).
7. MUST grant rewarded bonus strictly via `onRewarded` callback.
8. MUST avoid infinite loaders or blocking screens without progress.
9. MUST handle ad errors/timeouts gracefully and always unlock UI.
10. MUST ensure UI elements are fully visible on common aspect ratios.
11. MUST avoid external network requests outside the Yandex SDK.
12. MUST keep input responsive after ad close or tab restore.

### MUST NOT
13. MUST NOT show ads during active gameplay (PLAYING state).
14. MUST NOT display technical errors, stack traces, or debug text to users.
15. MUST NOT freeze or crash on ad failure, close, or SDK absence.
16. MUST NOT require mandatory ads to continue gameplay.
17. MUST NOT block gameplay due to low ad fill or offline mode.
18. MUST NOT trigger ads automatically on user input without clear context.
19. MUST NOT rely on unstable lifecycle timing (e.g., unbounded dt after resume).
20. MUST NOT break gameplay on screen rotation or resize.

Sources:
- https://yandex.ru/dev/games/doc/ru/concepts/requirements
- https://yandex.ru/dev/games/doc/ru/requirements/1/14
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events

## 2026-10-15 — ПОТОК: единая игра вместо несовместимых черновиков

Решения этой записи заменяют старые описания контрактов модулей.

- Рендеринг — процедурный Canvas 2D с перспективой. Babylon.js и внешние модели не требуются; симуляция не зависит от графики.
- Генерация оставляет открытый коридор в каждой волне; он сдвигается максимум на одну полосу. Одинаковая скорость машин в волне не позволяет им перекрывать собственный проход.
- Симуляция использует подшаги до 1/120 секунды, ограничивает большой dt и проверяет пересечение интервала столкновения. Возврат после долгой паузы не телепортирует машину.
- Множество независимых причин паузы: user, blur, hidden, platform, ad. Удаление одной причины не снимает остальные. После внешней паузы требуется явное продолжение.
- SDK загружается через /sdk.js только вне localhost. Готовность и желаемое состояние геймплея можно запросить до init: они синхронизируются после него. Подписки платформы, зарегистрированные до init, не теряются.
- Бесплатный второй шанс доступен при отсутствии рекламного API. При доступной rewarded-рекламе продолжение возможно только после onRewarded и завершения показа. Поздние события после завершения игнорируются.
- Награды и счёт продолженного заезда сохраняются, лимит продолжения — одно на весь заезд. Статистика не удваивается: при втором завершении добавляется только новая дистанция.
- Единый ночной интерфейс использует tokens/theme.json → styles/theme.css. Палитры игрового мира принадлежат config.js; смена атмосферы меняет мир, а семантика интерфейса остаётся общей.
- Звук генерируется локально и активируется только пользовательским действием. Системное предпочтение reduced motion отключает декоративное движение меню, вспышки защиты и линии ускорения.
- Реальная платформа и физические мобильные устройства остаются отдельной проверкой перед публикацией; локальные моки не подменяют её.

## 2026-10-15 — Визуальная переработка после оценки первого заезда

Запись о Canvas 2D выше заменена: мир переведён на настоящий WebGL 2 / Three.js. Модель купе построена из поперечных сечений кузова, стекла, оптики, колёс с дисками, зеркал, спойлера и выхлопа. У сцены есть освещение, тени, отражённые световые пятна на дороге, фасады, вывески, эстакады и придорожные объекты. Добавлены дождь, свечение, пламя нитро, расширение поля зрения, хроматический сдвиг при ускорении, частицы и удар камеры при столкновении. Reduced motion выключает декоративное движение и резкие эффекты.

Трафик присутствует с первых секунд: стартуют три волны с открытыми проходами, затем генерация продолжается по дистанции. Модели трафика и зарядов переиспользуются из пулов. Three.js и используемые дополнения собираются в локальный модуль public/vendor/three.js; лицензия включена. Сетевых обращений к CDN во время игры нет. Между столкновением и результатом оставлены 0,65 с для визуальной обратной связи; симуляция и разметка геймплея уже остановлены.


## 2026-10-15 — дневное загородное шоссе

По выбору пользователя ночной город заменён дневной загородной трассой. Неон, дождь, bloom и хроматическая постобработка удалены. Вместо процедурного кузова загружается модель vicent091036, вместо рисованных текстур — локальные материалы Poly Haven. Источники, лицензии и изменения перечислены в public/assets/CREDITS.txt. Деревья запечены из готовой модели в прозрачные изображения; исходник не включён в релиз. Три окружения меняют плотность леса. Старые ключи ring/neon/dawn оставлены только для совместимости сохранений. Старт и Game Ready ждут полной загрузки ресурсов; ошибка переводит кнопку в повторную загрузку.


## 2026-10-16 — ручное управление и дорожные события

По замечаниям пользователя отменена привязка к центрам полос: удерживаемый руль постепенно меняет угол колёс и направление движения. W/↑ отвечает за газ, S/↓ — за тормоз; без нажатий машина стоит или движется накатом. Тормоз имеет приоритет. Источники ввода учитываются отдельно, поэтому можно одновременно держать несколько клавиш или касаний; при паузе, отмене указателя и потере фокуса они освобождаются.

Камера держит ось дороги и не получает смещение от руления. Переходы меню/заезд, ориентации экрана и FOV сглаживаются по времени, не по числу кадров. Экспозиция снижена с 1,05 до 0,72, уменьшены фон, окружающий и солнечный свет.

Добавлен цикл дорожных работ, контрольных точек и тормозящей колонны. Это объекты и условия симуляции: столкновения с ограждениями, штрафы за конусы, проверка времени и положения в воротах, торможение машин и подтверждённые обгоны. Награды однократны. Колонна добавляется вдали, сохраняя существующие машины. Следующий за игроком автомобиль тормозит при остановке игрока.

## 2026-10-16 — интерфейс приборов вместо карточек

После замечания пользователя о шаблонном интерфейсе убраны отдельные скруглённые панели счёта, цели, скорости и нитро. На компьютере добавлен спидометр с реальной шкалой и стрелкой; на телефоне остаётся цифровая скорость, чтобы освободить обзор. Множитель появляется только при активной серии. Контраст сверху обеспечивает общая тень, предупреждения о событиях имеют отдельную узкую полосу. Педали визуально отделены от рулевых кнопок и поддерживают одновременное удержание.

Название меню — «ПОТОК», запуск — «Выехать», маршруты выбираются подчёркнутыми переключателями. Декоративные подзаголовки, иллюстрации в карточках и фразы про «чистую линию» удалены. Дневное окружение и механика заезда сохранены. В браузерные проверки добавлены соответствие приборов фактической скорости и отсутствие наложений показателей на всех проверяемых размерах.
