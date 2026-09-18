# Инспектор ИИ

«Инспектор ИИ» — интеллектуальный сервис для автоматической сверки проектной,
рабочей и исполнительной строительной документации. Репозиторий организован как
Bun-workspace с React-приложением, NestJS API и контейнерной инфраструктурой.

В проект входят:

- регистрация и вход по логину и паролю;
- JWT-сессии с ротацией refresh token;
- защищённые frontend- и backend-маршруты;
- роли `INSPECTOR`, `ADMINISTRATOR` и `ML_ENGINEER`;
- создание объектов, явные назначения инспекторов и реестр оригиналов;
- потоковая загрузка PDF/DOCX/XML, ClamAV, проверка структуры и SHA-256;
- PostgreSQL и миграции Prisma;
- Docker Compose для сборки и запуска production-образов;
- транзакционный outbox, RabbitMQ и отдельный worker доставки/контроля целостности.

Ветка `feat/document-parsing` добавляет фоновую обработку каждого файла,
локальный PP-StructureV3 с русским OCR, таблицы, структурный разбор DOCX/XML, сохранённый текст и просмотр
страниц с выделением фрагментов. **Для запуска этой ветки следуйте
[инструкции парсинга](docs/document-parsing.md)**: она включает подготовку моделей
и дополнительный секрет `PARSER_TOKEN`.

## Планирование и выполнение OpenSpec

Рабочие changes находятся в этом репозитории: [указатель OpenSpec](openspec/README.md).
Исходный большой change разделён на семь: приём, парсинг/OCR, идентификация,
извлечение фактов, геометрия, комплектность и инкрементальная обработка.
В каждом есть proposal, design, specs и отслеживаемые задачи.

Из корня репозитория: `openspec list`, `openspec status --change <имя>`,
`node openspec/verify-planning.mjs`. Чекбоксы в `tasks.md` отражают выполнение;
готовность планирования не означает готовность функций. Общие зависимости
и приёмка сохраняются в [открытом реестре](openspec/SHARED_BACKLOG.md).
Действующее ТЗ и приложения включены в [docs/requirements](docs/requirements/SOURCES.md).

## Стек

| Область        | Технологии                                             |
| -------------- | ------------------------------------------------------ |
| Frontend       | React 19, Vite, TypeScript, Tailwind CSS v4, HeroUI v3 |
| Данные и формы | Axios, TanStack Query, Zustand, React Hook Form, Zod   |
| Backend        | NestJS 11, Prisma 7, PostgreSQL                        |
| Инфраструктура | Bun workspaces, Docker Compose, Nginx, RabbitMQ        |
| Качество       | Vitest, ESLint, Prettier, Husky                        |

Менеджер пакетов проекта — **Bun 1.4.2**. Версия закреплена в корневом
`package.json` и Docker-образах. Не создавайте рядом `package-lock.json`,
`yarn.lock` или `pnpm-lock.yaml`.

## Выбор режима запуска

| Режим                | Для чего использовать              | Адрес приложения        |
| -------------------- | ---------------------------------- | ----------------------- |
| Локальная разработка | HMR frontend и watch-режим backend | <http://localhost:5173> |
| Docker Compose       | Собранные production-образы        | <http://localhost:8080> |

Оба сценария выполняются из корня репозитория. Не запускайте их одновременно:
они используют одни и те же порты PostgreSQL и RabbitMQ.

## Локальная разработка

В этом режиме frontend и backend работают на хосте под Bun, а PostgreSQL и
RabbitMQ запускаются в Docker. Изменения frontend применяются через Vite HMR,
backend перезапускается через Nest watch.

### 1. Установите инструменты

Потребуются:

- Bun 1.4.2;
- Docker Engine или Docker Desktop;
- Docker Compose v2 с командой `docker compose`;
- OpenSSL для генерации секретов.

Проверьте установку:

```bash
bun --version
docker compose version
openssl version
```

### 2. Установите зависимости

```bash
bun install --frozen-lockfile
```

Зависимости всех workspaces устанавливаются из корня по единому `bun.lock`.

### 3. Подготовьте переменные окружения

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Сгенерируйте три разных секрета:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Запишите первый результат в `JWT_SECRET`, второй — в `JWT_REFRESH_SECRET`, третий —
в `PARSER_TOKEN` файла `backend/.env`. Секреты должны отличаться и содержать не менее 32 символов.
Остальные значения примеров уже соответствуют локальным портам.

`frontend/.env`:

```dotenv
VITE_API_URL=http://localhost:3000/api
```

`backend/.env`:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
FRONTEND_URL=http://localhost:5173
```

Корневой `.env` для этого режима не требуется: Docker Compose получит значения
для интерполяции из `backend/.env` через параметр `--env-file`.

### 4. Запустите инфраструктуру

```bash
docker compose --env-file backend/.env up --detach --wait postgres rabbitmq
docker compose --env-file backend/.env ps
```

Оба контейнера должны перейти в состояние `healthy`.

### 5. Подготовьте базу данных и Prisma Client

```bash
bun run prisma:generate
bun run --cwd backend prisma:deploy
```

`prisma:generate` создаёт типизированный клиент в
`backend/src/generated/prisma`. Команда `prisma:deploy` применяет уже
зафиксированные миграции из `backend/prisma/migrations` и не создаёт новые.

### 6. Запустите frontend и backend

```bash
bun run dev
```

Команда запускает оба workspace параллельно. После старта доступны:

| Сервис              | Адрес                              |
| ------------------- | ---------------------------------- |
| Frontend            | <http://localhost:5173>            |
| API                 | <http://localhost:3000/api>        |
| Swagger UI          | <http://localhost:3000/api/docs>   |
| Healthcheck         | <http://localhost:3000/api/health> |
| PostgreSQL          | `localhost:5432`                   |
| RabbitMQ AMQP       | `localhost:5672`                   |
| RabbitMQ Management | <http://localhost:15672>           |

Для проверки интерфейса откройте `/register`, создайте пользователя, затем
перейдите в защищённую рабочую область `/app`.

### Остановка локальной среды

Остановите `bun run dev` сочетанием `Ctrl+C`, затем остановите контейнеры:

```bash
docker compose --env-file backend/.env stop postgres rabbitmq
```

Команда не удаляет данные PostgreSQL и RabbitMQ. При следующем запуске они будут
доступны в тех же именованных volumes.

## Деплой через Docker Compose

Этот сценарий собирает production frontend, backend и отдельный образ миграций.
Nginx публикует приложение на порту `8080`, обслуживает SPA и проксирует `/api`
в backend. Сам backend на хост напрямую не публикуется.

### 1. Подготовьте сервер

На сервере потребуются Git, Docker Engine, Docker Compose v2 и OpenSSL. Склонируйте
репозиторий, перейдите в его корень и создайте production-конфигурацию:

```bash
cp .env.example .env
```

В `.env` обязательно:

1. замените `POSTGRES_PASSWORD=postgres` на стойкий URL-safe пароль;
2. задайте разные `JWT_SECRET`, `JWT_REFRESH_SECRET` и `PARSER_TOKEN` длиной не менее 32 символов;
3. при необходимости измените `JWT_ACCESS_TTL` и `JWT_REFRESH_TTL`;
4. при необходимости измените внешний `POSTGRES_PORT`; между контейнерами используется порт 5432.

Секреты можно получить той же командой `openssl rand -base64 48`, запущенной три
раза. Не добавляйте `.env` в Git.

### 2. Выберите целевую среду

Без дополнительной конфигурации Compose подходит для локальной проверки
production-образов на `http://localhost:8080`.

Для публичного деплоя добавьте в корневой `.env` адрес приложения и точное число
доверенных proxy-hop:

```dotenv
FRONTEND_URL=https://inspector.example.ru
TRUST_PROXY_HOPS=2
```

Затем сохраните вне Git-репозитория, например в
`/etc/inspector-ai/compose.deploy.yaml`, deployment override:

```yaml
services:
  postgres:
    restart: unless-stopped
  rabbitmq:
    restart: unless-stopped
  backend:
    restart: unless-stopped
    environment:
      FRONTEND_URL: ${FRONTEND_URL:?FRONTEND_URL must be set}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-2}
  frontend:
    restart: unless-stopped
```

Значение `2` соответствует цепочке «внешний TLS reverse proxy → встроенный
Nginx → backend». Если схема проксирования отличается, укажите фактическое число
доверенных переходов. Прямой доступ извне к порту `8080` при этом нужно закрыть.

Для публичного запуска также:

1. установите внешний reverse proxy с TLS-сертификатом перед frontend;
2. разрешите извне только HTTP/HTTPS-трафик reverse proxy;
3. закройте порты `5432`, `5672` и `15672` с помощью firewall или измените их
   публикацию в Compose.

HTTPS обязателен: production refresh cookie создаётся с флагом `Secure`.
`FRONTEND_URL` должен в точности совпадать с origin, который видит браузер.

### 3. Проверьте конфигурацию

```bash
# Локальная проверка production-образов
docker compose config --quiet

# Публичный деплой с override
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  config --quiet
```

Используйте `--quiet`: обычный `docker compose config` выводит раскрытые значения
переменных, включая секреты.

### 4. Соберите и запустите сервисы

До первого запуска подготовьте локальные модели OCR. Эта команда скачивает только
модели и не подключает документы:

```bash
docker compose --profile tools run --rm --build parser-models
```

```bash
# Локальная проверка production-образов
docker compose up --detach --build --wait

# Публичный деплой с override
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  up --detach --build --wait
```

Compose выполняет запуск в следующем порядке:

1. ждёт готовности PostgreSQL;
2. запускает одноразовый сервис `migrate` с `prisma migrate deploy`;
3. запускает backend только после успешных миграций;
4. запускает frontend после успешного healthcheck backend.

### 5. Проверьте деплой

```bash
docker compose ps --all
docker compose logs migrate
curl --fail http://localhost:8080/api/health
```

При публичном деплое добавляйте те же параметры `--env-file` и `-f` ко всем
командам `docker compose`, а healthcheck вызывайте по HTTPS на своём домене.

Ответ healthcheck должен быть `{"ok":true}`. Состояние `Exited (0)` у сервиса
`migrate` означает, что одноразовая миграция завершилась успешно.

| Сервис                 | Адрес в стандартной конфигурации   |
| ---------------------- | ---------------------------------- |
| Приложение             | <http://localhost:8080>            |
| API через Nginx        | <http://localhost:8080/api>        |
| Swagger UI через Nginx | <http://localhost:8080/api/docs>   |
| Healthcheck            | <http://localhost:8080/api/health> |

Для доменного развёртывания замените `localhost:8080` на публичный адрес.

### Логи и диагностика

```bash
docker compose logs --follow --tail=200 backend frontend
docker compose logs postgres migrate
```

### Обновление

Перед обновлением сделайте резервную копию PostgreSQL. Затем получите изменения
и пересоберите сервисы:

```bash
git pull --ff-only
docker compose up --detach --build --wait
docker compose ps --all
docker compose logs migrate
```

Новые миграции применятся сервисом `migrate` до запуска обновлённого backend.

### Остановка

```bash
docker compose down
```

Именованные volumes `postgres-data` и `rabbitmq-data` сохраняются. Команда
`docker compose down --volumes` удаляет оба volume вместе с данными; не
используйте её без резервной копии и явного намерения полностью очистить среду.

## Переменные окружения

### Локальная разработка

| Файл            | Переменная           | Назначение                                                |
| --------------- | -------------------- | --------------------------------------------------------- |
| `frontend/.env` | `VITE_API_URL`       | Базовый URL API, по умолчанию `http://localhost:3000/api` |
| `backend/.env`  | `DATABASE_URL`       | PostgreSQL connection string для процесса на хосте        |
| `backend/.env`  | `FRONTEND_URL`       | Разрешённый CORS origin frontend                          |
| `backend/.env`  | `JWT_SECRET`         | Секрет access token, минимум 32 символа                   |
| `backend/.env`  | `JWT_REFRESH_SECRET` | Отдельный секрет refresh token, минимум 32 символа        |
| `backend/.env`  | `JWT_ACCESS_TTL`     | Срок access token, по умолчанию `20m`                     |
| `backend/.env`  | `JWT_REFRESH_TTL`    | Срок refresh token, по умолчанию `7d`                     |
| `backend/.env`  | `NODE_ENV`           | Режим `development`, `production` или `test`              |
| `backend/.env`  | `PORT`               | Порт NestJS, по умолчанию `3000`                          |
| `backend/.env`  | `TRUST_PROXY_HOPS`   | Число доверенных proxy-hop, локально `0`                  |

### Docker Compose

| Переменная в корневом `.env` | Назначение                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `POSTGRES_DB`                | Имя базы данных                                                   |
| `POSTGRES_USER`              | Пользователь PostgreSQL                                           |
| `POSTGRES_PASSWORD`          | Пароль PostgreSQL                                                 |
| `POSTGRES_PORT`              | Опубликованный порт PostgreSQL; в текущем Compose оставьте `5432` |
| `JWT_SECRET`                 | Секрет access token                                               |
| `JWT_REFRESH_SECRET`         | Секрет refresh token                                              |
| `JWT_ACCESS_TTL`             | Срок access token                                                 |
| `JWT_REFRESH_TTL`            | Срок refresh token                                                |
| `FRONTEND_URL`               | Публичный origin для deployment override                          |
| `TRUST_PROXY_HOPS`           | Число доверенных proxy-hop для deployment override                |

TTL принимает целое число секунд либо значение с суффиксом `s`, `m`, `h`, `d`
или `w`: например `90s`, `15m`, `2h`, `7d`, `1w`. Срок access token должен быть
меньше срока refresh token; максимальное значение — 365 дней.

## Аутентификация

Пользователь регистрируется и входит по полю `login` («Логин») и паролю. Логин
нормализуется в нижний регистр, пароль хранится только в виде `scrypt`-хеша.

После регистрации или входа API создаёт серверную сессию и выдаёт пару JWT:

- access token возвращается в JSON, хранится только в памяти frontend и
  передаётся как `Authorization: Bearer <token>`;
- refresh token хранится в `HttpOnly`, `SameSite=Lax` cookie, а в PostgreSQL
  сохраняется только его SHA-256-хеш;
- после ответа `401` frontend выполняет один refresh-запрос и повторяет исходный
  запрос ровно один раз;
- при обновлении refresh token ротируется, предыдущий токен отзывается;
- logout отзывает серверную сессию и очищает refresh cookie.

Запросы, изменяющие сессию, требуют заголовок `X-Inspector-Request: 1`;
frontend-клиент добавляет его автоматически. Для auth-эндпоинтов действует
ограничение частоты запросов.

| Метод  | Путь                 | Назначение                        |
| ------ | -------------------- | --------------------------------- |
| `POST` | `/api/auth/register` | Создать пользователя и сессию     |
| `POST` | `/api/auth/login`    | Войти                             |
| `POST` | `/api/auth/refresh`  | Ротировать access и refresh token |
| `GET`  | `/api/auth/me`       | Получить текущего пользователя    |
| `POST` | `/api/auth/logout`   | Завершить браузерную сессию       |

## Команды разработки

| Команда                                | Назначение                                  |
| -------------------------------------- | ------------------------------------------- |
| `bun run dev`                          | Запустить frontend и backend в watch-режиме |
| `bun run build`                        | Собрать оба workspace                       |
| `bun run eslint`                       | Запустить ESLint                            |
| `bun run prettier`                     | Отформатировать проект                      |
| `bun run typecheck`                    | Проверить TypeScript                        |
| `bun run lint`                         | Полный линтер перед коммитом                |
| `bun run test`                         | Запустить все тесты                         |
| `bun run test:coverage`                | Запустить тесты с отчётом покрытия          |
| `bun run prisma:generate`              | Сгенерировать Prisma Client                 |
| `bun run --cwd backend prisma:deploy`  | Применить существующие миграции             |
| `bun run --cwd backend prisma:migrate` | Создать и применить dev-миграцию            |

`prisma:migrate` предназначена только для разработки. В production миграции
применяются неинтерактивной командой `prisma migrate deploy` внутри сервиса
`migrate`.

## Объекты и приём документов

Первый change — `add-safe-document-ingestion`. Инспектор создаёт объект в `/app/objects`,
получает явное назначение и загружает документы в его карточке. Название не
является идентификатором. После перезагрузки карточка, оригиналы и подтверждение
последней загрузки восстанавливаются через API. Карточка доступна по адресу
`/app/objects/:objectId`; `/app` сохраняет dashboard. Страницы объектов используют
общий `WorkspaceLayout`, тему и компоненты загрузки нового интерфейса.
Демонстрационная страница `/app/documents/upload` сохраняет явную пометку «ДЕМО»;
на страницах объектов данные и операции загрузки/скачивания поступают из API.

После применения миграции `20260916172631_update_default_role` новые пользователи
получают роль `INSPECTOR` по умолчанию. Миграция не меняет роли существующих
пользователей и не выдаёт назначения на чужие объекты.

Политика доступа подтверждена владельцем: инспектор работает только с назначенными
объектами; администратор управляет назначениями, но не читает документы автоматически;
ML-инженер и пользователь без роли к этому сценарию доступа не имеют.

### Первоначальные роли и назначения

Зарегистрируйте будущего администратора и инспектора через обычную форму. Затем
оператор развёртывания один раз назначает первого администратора (команда требует
доступа к контейнеру/БД и отказывает, если администратор уже существует):

```bash
docker compose exec backend bun backend/dist/admin.js bootstrap admin-login
```

Задайте `ADMIN_LOGIN` и `ADMIN_PASSWORD` в окружении своей оболочки. Пароль не
передаётся аргументом и не записывается в репозиторий. Последующие команды входят
через действующий AuthService, проверяют роль и сохраняют аудит:

```bash
docker compose exec -e ADMIN_LOGIN -e ADMIN_PASSWORD backend bun backend/dist/admin.js role inspector-login INSPECTOR
docker compose exec -e ADMIN_LOGIN -e ADMIN_PASSWORD backend bun backend/dist/admin.js grant OBJECT_UUID USER_ID
docker compose exec -e ADMIN_LOGIN -e ADMIN_PASSWORD backend bun backend/dist/admin.js revoke OBJECT_UUID USER_ID
```

`USER_ID` — существующий идентификатор из `/api/auth/me`, `OBJECT_UUID` — из URL
карточки. Для создания объекта инспектором команда `grant` не нужна. После смены
роли обновите страницу. Авторство не сохраняет доступ после отзыва назначения.
Ручная вставка объектов или изменение SQL для рабочего сценария не требуется.

### Storage, проверка и worker

Полный `docker compose up -d --build` запускает API, worker, PostgreSQL, RabbitMQ,
ClamAV и изолированный валидатор PDF/DOCX/XML. Начальная загрузка сигнатур ClamAV
может занять несколько минут; `docker compose logs clamav` показывает готовность.
До готовности сканера документы отклоняются с понятной причиной.

Оригиналы находятся в закрытом volume `document-originals`, производные — в
`document-derived`, карантин — в tmpfs объёмом 1 ГБ. Публичного URL к файлам нет.
Валидатор получает только read-only карантин, работает без внешней сети, с лимитами
CPU, памяти и времени. Он проверяет структуру, а не выполняет OCR.

Восстановимое предупреждение qpdf без ошибок не считается небезопасным форматом.
PDF после такого предупреждения проходит остальные проверки; активное содержимое
и ошибки чтения по-прежнему приводят к отказу. Исходные байты не переписываются.

Одинаковые байты (SHA-256) принимаются только один раз в пределах объекта,
включая повтор после перезагрузки страницы, переименование и одновременные
запросы. Дубль возвращает `accepted=false`, `error=duplicate_file` и
`existing_file_id`; в интерфейсе доступно скачивание сохранённого оригинала.
Новые файлы из смешанного пакета принимаются. То же имя с другим содержимым
и тот же файл в другом доступном объекте разрешены. При одних дублях ответ
`422` не создаёт процесс или задание; аудит считает дубли отдельно от отказов.
Миграция `20260918010000_deduplicate_object_files` сохраняет исторические дубли,
а уникальный реестр `object_file_contents` запрещает новые на уровне БД.

JSON/base64 принимается потоком: **50 000 000 байт на файл**, **200 000 000 байт
на пакет**, включая отклонённые файлы. Пакет больше лимита отклоняется целиком.
Nginx допускает 270 000 000 байт wire body только на upload-route. Передача имеет
отдельный timeout 650 секунд; остальные запросы сохраняют прежние ограничения.

`202` означает сохранённые оригиналы и транзакционно созданные Process/Run,
неизменяемый InputManifest, Job и Outbox. `422` содержит индивидуальные причины,
но не создаёт процесс без входов. Receipt сохраняется и для полного отказа:
после исправления файла/доступности сканера используйте **новый пакет**. Повтор
неизменённого запроса с тем же `client_upload_id` возвращает прежний результат;
изменение содержимого даёт `409`. После потери ответа сначала проверьте receipt.

Worker публикует подтверждённые persistent-сообщения в durable-очереди
`inspector.documents.accepted` и `inspector.events`. Доставка допускает повторы:
будущий потребитель обязан дедуплицировать `event_id` и проверять версию запуска.
После 20 неудач outbox остаётся в БД; оператор после устранения причины выполняет:

```bash
docker compose exec -e ADMIN_LOGIN -e ADMIN_PASSWORD backend bun backend/dist/admin.js retry-outbox EVENT_UUID
```

Worker проверяет исходный SHA-256 не реже очередного суточного срока, помечает
повреждённый файл и создаёт `file.integrity-failed`. Такой файл нельзя скачать или
включить в новый запуск. Очистка удаляет только неподтверждённые handles старше
24 часов; принятые оригиналы, manifest и receipt не удаляются. Для восстановления
после аварии сохраняйте **вместе БД и volume оригиналов**.

Для локального API с настройками `backend/.env.example` создайте
`backend/var/documents/quarantine` (в Linux владелец UID 1000) и запустите:

```bash
docker compose --env-file backend/.env -f compose.yaml -f compose.dev.yaml up -d --build postgres rabbitmq clamav validator validator-proxy
bun run build
bun run --cwd backend worker
```

API/frontend запускаются отдельной командой `bun run dev`. Override открывает
сканер и proxy валидатора только на localhost; не используйте его для production.

### API и проверка изменения

OpenAPI в `/api/docs` содержит DTO, ответы и примеры. `/api/auth/*` сохранены.
Основные новые маршруты:

| Метод    | Маршрут                                                  | Назначение                    |
| -------- | -------------------------------------------------------- | ----------------------------- |
| POST/GET | `/api/v1/objects`                                        | Создание / доступный реестр   |
| GET      | `/api/v1/objects/{object_id}`                            | Карточка                      |
| POST     | `/api/v1/documents/upload`                               | Приём JSON/base64             |
| GET      | `/api/v1/objects/{object_id}/uploads/{client_upload_id}` | Receipt текущего пользователя |
| GET      | `/api/v1/objects/{object_id}/files`                      | Реестр оригиналов             |
| GET      | `/api/v1/objects/{object_id}/files/{file_id}/original`   | Авторизованное скачивание     |
| GET      | `/api/v1/processes/{process_id}`                         | Состояние и последний запуск  |

Обычные тесты используют синтетические данные. Для интеграционной проверки
реальных PostgreSQL/RabbitMQ/ClamAV/валидатора/Nginx выделен отдельный стенд:

```bash
bun run --cwd backend test:services
bun run --cwd backend test:integration
docker compose -p inspector-ingestion-test -f compose.ingestion-test.yaml down
```

Стенд использует localhost-порты 25432, 25672, 25673, 23310, 28080, 28081 и API 3302. Каждый прогон создаёт отдельную БД `ingestion_<uuid>`; существующая БД
приложения не используется. Отчёты и синтетические файлы остаются в игнорируемом
`.test-output/`, миграции проверяются с нуля. После удаления контейнера PostgreSQL
эти временные базы не сохраняются. ClamAV сохраняет только сигнатуры в test volume.

Для отдельного разрешённого корпуса есть opt-in команда
`node backend/test/admission-corpus.mjs <каталог>` из корня. Она требует
`CORPUS_LOGIN`, `CORPUS_PASSWORD` и необязательный `CORPUS_API` (по умолчанию
`http://localhost:3303/api`), допускает только localhost, сохраняет JSONL с исходным
и скачанным SHA-256/размером/результатом. Исходный каталог не изменяется.

Подробная приёмка: [evidence.md](openspec/changes/add-safe-document-ingestion/evidence.md).
Парсинг/OCR и потребитель PAR описаны в [инструкции](docs/document-parsing.md).
Процесс имеет `PARSING` во время обработки текущего Run, затем возвращается в
`PENDING` с отдельными результатами файлов. Извлечение по Матрице, комплектность,
протокол и доставка уведомлений C23 относятся к следующим этапам.
Общая приёмка C24, TLS на внешнем ingress,
шифрование носителей/backup, восстановление, нагрузка 100 инспекторов и решение
Node.js/Bun остаются открытыми обязательствами [общего реестра](openspec/SHARED_BACKLOG.md).

## Решение проблем

### Compose требует `JWT_SECRET`

Для dev запускайте инфраструктуру с `--env-file backend/.env` и убедитесь, что
оба секрета заполнены. Для production заполните корневой `.env`.

### Prisma сообщает `P1001: Can't reach database server`

Проверьте состояние PostgreSQL:

```bash
docker compose --env-file backend/.env ps postgres
docker compose --env-file backend/.env logs postgres
```

Локальный backend подключается к `localhost:5432`. Контейнеры `backend` и
`migrate` получают адрес сервиса `postgres` автоматически из `compose.yaml`;
внутри контейнера нельзя использовать `localhost` для подключения к PostgreSQL.

### Backend не запускается после клонирования

Сначала сгенерируйте Prisma Client и проверьте переменные окружения:

```bash
bun run prisma:generate
bun run --cwd backend typecheck
```

### Порты уже заняты

По умолчанию используются `5173`, `3000`, `5432`, `5672`, `15672` и `8080`.
Остановите конфликтующий процесс или контейнер перед запуском выбранного режима.

### Авторизация не работает после внешнего деплоя

Проверьте HTTPS, точное совпадение публичного origin с `FRONTEND_URL` и передачу
cookie через reverse proxy. Для диагностики используйте логи frontend и backend,
а также вкладки Network и Application браузера.
