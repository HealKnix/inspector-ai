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
- транзакционный outbox, RabbitMQ и отдельные workers для приёма и парсинга;
- локальный PP-StructureV3 с русским OCR, таблицы, структурный разбор DOCX/XML, сохранённый текст и просмотр.

Устройство контура парсинга, контракты и диагностические команды подробнее
описаны в [инструкции парсинга](docs/document-parsing.md).

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
| Инфраструктура | Bun workspaces, Docker Compose, Nginx, RabbitMQ, Redis |
| Качество       | Vitest, ESLint, Prettier, Husky                        |

Менеджер пакетов проекта — **Bun 1.4.2**. Версия закреплена в корневом
`package.json` и Docker-образах. Не создавайте рядом `package-lock.json`,
`yarn.lock` или `pnpm-lock.yaml`.

## Выбор режима запуска

| Режим                | Для чего использовать                    | Адрес приложения        |
| -------------------- | ---------------------------------------- | ----------------------- |
| Всё в Docker         | Первый запуск и проверка полного контура | <http://localhost:8080> |
| Локальная разработка | HMR frontend и watch-режим backend       | <http://localhost:5173> |

Оба сценария выполняются из корня репозитория. Не запускайте их одновременно:
они используют одни и те же порты PostgreSQL, RabbitMQ и других сервисов.

Полный контур состоит не только из PostgreSQL и RabbitMQ:

| Сервис           | Назначение                                       |
| ---------------- | ------------------------------------------------ |
| `postgres`       | База данных приложения                           |
| `rabbitmq`       | Очереди приёма документов и событий              |
| `redis`          | Временный кеш результатов парсинга               |
| `clamav`         | Антивирусная проверка загружаемых файлов         |
| `validator`      | Изолированная проверка структуры PDF, DOCX и XML |
| `parser`         | OCR и структурный разбор документов              |
| `migrate`        | Одноразовое применение миграций Prisma           |
| `backend`        | NestJS API                                       |
| `worker`         | Outbox и контроль целостности оригиналов         |
| `parsing-worker` | Получение заданий из RabbitMQ и вызов парсера    |
| `frontend`       | Production-сборка React за Nginx                 |

`parser-models` — отдельный служебный сервис профиля `tools`. Он загружает OCR-модели
в именованный volume и не запускается обычной командой `docker compose up`.

## Быстрый запуск: всё в Docker

Это рекомендуемый способ первого запуска: Compose собирает и поднимает весь
контур, включая API, оба worker-процесса, парсер и frontend.

### 1. Установите инструменты

Потребуются Docker Engine или Docker Desktop, Docker Compose v2, Git и OpenSSL.
Для первой сборки и загрузки OCR-моделей нужен доступ в интернет. Парсер имеет
лимит памяти 4 ГБ, поэтому Docker должен располагать памятью и для него, и для
остальных контейнеров.

```bash
docker version
docker compose version
openssl version
```

Если Docker доступен только через `sudo`, добавляйте `sudo` перед всеми командами
`docker compose`. Не запускайте часть команд с `sudo`, а часть без него.

### 2. Подготовьте окружение

```bash
cp .env.example .env
```

В `.env`:

1. замените `POSTGRES_PASSWORD=postgres` на стойкий URL-safe пароль;
2. задайте три разных значения длиной не менее 32 символов для `JWT_SECRET`,
   `JWT_REFRESH_SECRET` и `PARSER_TOKEN`;
3. при необходимости измените TTL токенов, внешний порт PostgreSQL и параметры
   парсера.

Секреты можно сгенерировать тремя отдельными вызовами:

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

Не добавляйте `.env` в Git. Перед запуском проверьте Compose без вывода раскрытых
переменных окружения:

```bash
docker compose --env-file .env config --quiet
```

### 3. Загрузите OCR-модели

Этот шаг обязателен перед первым запуском и после изменения набора моделей:

```bash
docker compose --env-file .env --profile tools run --rm --build parser-models
```

Модели сохраняются в volume `parser-models`, поэтому при обычном перезапуске
повторно загружать их не нужно.

### 4. Запустите полный контур

```bash
docker compose --env-file .env up --detach --build --wait --wait-timeout 900
```

Не указывайте после `up` только `frontend`: его цепочка зависимостей не включает
worker, RabbitMQ, Redis, ClamAV, валидатор и парсер.

При старте Compose:

1. поднимает хранилища и инфраструктурные сервисы;
2. после готовности PostgreSQL применяет миграции сервисом `migrate`;
3. запускает API и `worker` после успешных миграций;
4. запускает `parsing-worker` после готовности RabbitMQ и парсера;
5. запускает frontend после healthcheck API.

Первичная загрузка сигнатур ClamAV и моделей парсера может занять несколько минут.

### 5. Проверьте запуск

```bash
docker compose --env-file .env ps --all
docker compose --env-file .env logs migrate
docker compose --env-file .env exec -T clamav clamdscan --ping 1
curl --fail http://localhost:8080/api/health
```

Ожидаемый результат:

- `migrate` завершился с кодом `0`;
- сервисы с healthcheck находятся в состоянии `healthy`;
- `clamdscan --ping` сообщает, что ClamAV доступен;
- API отвечает `{"ok":true}`.

`/api/health` проверяет только доступность API, а не всех его зависимостей. Если
загрузка или парсинг не работают, дополнительно смотрите состояние и логи
`clamav`, `validator`, `rabbitmq`, `worker`, `parser` и `parsing-worker`.

| Сервис              | Адрес в стандартной конфигурации |
| ------------------- | -------------------------------- |
| Приложение          | <http://localhost:8080>          |
| API                 | <http://localhost:8080/api>      |
| Swagger UI          | <http://localhost:8080/api/docs> |
| RabbitMQ Management | <http://localhost:15672>         |

Для проверки интерфейса откройте `/register`, создайте пользователя, затем
перейдите в защищённую рабочую область `/app`.

### Логи, остановка и повторный запуск

```bash
docker compose --env-file .env logs --follow --tail=200 \
  backend worker parsing-worker parser clamav validator frontend
docker compose --env-file .env down
```

`down` удаляет контейнеры и сети, но сохраняет данные в именованных volumes.
Следующий запуск выполняется командой из шага 4. Не используйте `down --volumes`
без намерения полностью очистить среду: будут удалены база, оригиналы и производные
документы, RabbitMQ, сигнатуры ClamAV и OCR-модели.

## Локальная разработка

В этом режиме frontend, API и оба worker-процесса работают на хосте под Bun.
PostgreSQL, RabbitMQ, Redis, ClamAV, валидатор и парсер запускаются в Docker.
Frontend обновляется через Vite HMR, backend — через Nest watch.

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

### 4. Подготовьте локальное хранилище и модели

Создайте bind mount-каталоги от имени обычного пользователя:

```bash
mkdir -p backend/var/documents/{originals,derived,quarantine}
```

На Linux задайте UID/GID пользователя, чтобы контейнеры парсера и валидатора не
создавали файлы от имени `root`:

```bash
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
```

Загрузите OCR-модели. Используйте оба Compose-файла во всех командах этого режима:

```bash
docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml \
  --profile tools run --rm --build parser-models
```

Если Docker требует `sudo`, передайте UID/GID через `sudo env`, например:

```bash
sudo env LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml \
  --profile tools run --rm --build parser-models
```

### 5. Запустите инфраструктуру

```bash
docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml \
  up --detach --build --wait --wait-timeout 900 \
  postgres rabbitmq redis clamav validator validator-proxy parser parser-proxy
```

Список сервисов в конце команды обязателен. Если выполнить объединённый `up` без
него, дополнительно запустятся production-контейнеры API/frontend/workers, а API
и parser/validator будут смотреть в разные хранилища документов.

Проверка инфраструктуры:

```bash
docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml ps --all
docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml exec -T clamav clamdscan --ping 1
```

### 6. Подготовьте базу данных и worker-сборку

```bash
bun run prisma:generate
bun run --cwd backend prisma:deploy
bun run --cwd backend build
```

`prisma:generate` создаёт типизированный клиент в
`backend/src/generated/prisma`. Команда `prisma:deploy` применяет уже
зафиксированные миграции из `backend/prisma/migrations` и не создаёт новые.

`worker` и `parsing-worker` запускаются из `backend/dist`, поэтому сборка обязательна.
После изменения их исходников повторите `bun run --cwd backend build` и перезапустите
соответствующий процесс.

### 7. Запустите приложение и workers

Запустите одну команду

```bash
bun run dev:all
```

или откройте три терминала из корня репозитория.

Терминал 1 — frontend и API в watch-режиме:

```bash
bun run dev
```

Терминал 2 — outbox и контроль целостности:

```bash
bun run --cwd backend worker
```

Терминал 3 — очередь парсинга:

```bash
bun run --cwd backend parsing:worker
```

Корневая команда `bun run dev` не запускает workers. Для полноценной загрузки и
парсинга нужны все три процесса.

После старта доступны:

| Сервис              | Адрес                              |
| ------------------- | ---------------------------------- |
| Frontend            | <http://localhost:5173>            |
| API                 | <http://localhost:3000/api>        |
| Swagger UI          | <http://localhost:3000/api/docs>   |
| Healthcheck         | <http://localhost:3000/api/health> |
| PostgreSQL          | `localhost:5432`                   |
| RabbitMQ AMQP       | `localhost:5672`                   |
| RabbitMQ Management | <http://localhost:15672>           |
| Redis               | `localhost:6379`                   |
| ClamAV              | `localhost:3310`                   |
| Validator proxy     | <http://localhost:8081>            |
| Parser proxy        | <http://localhost:8090>            |

Для проверки интерфейса откройте `/register`, создайте пользователя, затем
перейдите в защищённую рабочую область `/app`.

### Остановка локальной среды

Остановите три Bun-процесса сочетанием `Ctrl+C`, затем удалите dev-контейнеры и
сеть без удаления данных:

```bash
docker compose --env-file backend/.env \
  -f compose.yaml -f compose.dev.yaml down
```

Каталоги `backend/var/documents` и именованные volumes сохраняются.

## Деплой через Docker Compose

Базовый production-запуск уже описан в разделе «Быстрый запуск». Ниже приведены
дополнительные настройки для публичного сервера. Nginx публикует приложение на
порту `8080`, обслуживает SPA и проксирует `/api` в backend; сам backend наружу
не публикуется.

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

### 2. Настройте публичный адрес

Добавьте в корневой `.env` адрес приложения и точное число
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
  redis:
    restart: unless-stopped
  backend:
    restart: unless-stopped
    environment:
      FRONTEND_URL: ${FRONTEND_URL:?FRONTEND_URL must be set}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-2}
  frontend:
    restart: unless-stopped
  worker:
    restart: unless-stopped
  clamav:
    restart: unless-stopped
  validator:
    restart: unless-stopped
  parser:
    restart: unless-stopped
  parsing-worker:
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
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  config --quiet
```

Используйте `--quiet`: обычный `docker compose config` выводит раскрытые значения
переменных, включая секреты.

### 4. Подготовьте модели и запустите сервисы

До первого запуска подготовьте локальные модели OCR. Эта команда скачивает только
модели и не подключает документы:

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  --profile tools run --rm --build parser-models

docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  up --detach --build --wait --wait-timeout 900
```

### 5. Проверьте деплой

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml ps --all
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml logs migrate
curl --fail https://inspector.example.ru/api/health
```

При публичном деплое добавляйте те же параметры `--env-file` и `-f` ко всем
командам `docker compose`, а healthcheck вызывайте по HTTPS на своём домене.

Ответ healthcheck должен быть `{"ok":true}`. Состояние `Exited (0)` у сервиса
`migrate` означает, что одноразовая миграция завершилась успешно.

### Логи и диагностика

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  logs --follow --tail=200 backend worker parsing-worker parser frontend
```

### Обновление

Перед обновлением сделайте резервную копию PostgreSQL. Затем получите изменения
и пересоберите сервисы:

```bash
git pull --ff-only
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml \
  up --detach --build --wait --wait-timeout 900
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml ps --all
```

Новые миграции применятся сервисом `migrate` до запуска обновлённого backend.

### Остановка

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f /etc/inspector-ai/compose.deploy.yaml down
```

Именованные volumes сохраняются. Перед обновлением и восстановлением делайте
согласованную резервную копию как минимум PostgreSQL и `document-originals`.
`down --volumes` удаляет все данные приложения и загруженные модели; не используйте
эту команду без резервной копии и явного намерения полностью очистить среду.

## Переменные окружения

### Локальная разработка

| Файл            | Переменная                    | Назначение                                                |
| --------------- | ----------------------------- | --------------------------------------------------------- |
| `frontend/.env` | `VITE_API_URL`                | Базовый URL API, по умолчанию `http://localhost:3000/api` |
| `backend/.env`  | `DATABASE_URL`                | PostgreSQL connection string для процесса на хосте        |
| `backend/.env`  | `FRONTEND_URL`                | Разрешённый CORS origin frontend                          |
| `backend/.env`  | `JWT_SECRET`                  | Секрет access token, минимум 32 символа                   |
| `backend/.env`  | `JWT_REFRESH_SECRET`          | Отдельный секрет refresh token, минимум 32 символа        |
| `backend/.env`  | `JWT_ACCESS_TTL`              | Срок access token, по умолчанию `20m`                     |
| `backend/.env`  | `JWT_REFRESH_TTL`             | Срок refresh token, по умолчанию `7d`                     |
| `backend/.env`  | `NODE_ENV`                    | Режим `development`, `production` или `test`              |
| `backend/.env`  | `PORT`                        | Порт NestJS, по умолчанию `3000`                          |
| `backend/.env`  | `TRUST_PROXY_HOPS`            | Число доверенных proxy-hop, локально `0`                  |
| `backend/.env`  | `STORAGE_ROOT`                | Корень хранилища документов                               |
| `backend/.env`  | `CLAMAV_HOST/PORT`            | Адрес ClamAV                                              |
| `backend/.env`  | `FILE_VALIDATOR_URL`          | URL изолированного валидатора                             |
| `backend/.env`  | `RABBITMQ_URL`                | URL RabbitMQ                                              |
| `backend/.env`  | `PARSER_URL`                  | URL parser proxy                                          |
| `backend/.env`  | `PARSER_TOKEN`                | Отдельный секрет доступа к парсеру, минимум 32 символа    |
| `backend/.env`  | `PARSER_FILE_TIMEOUT_SECONDS` | Таймаут обработки одного файла                            |
| `backend/.env`  | `REDIS_URL`                   | URL Redis                                                 |

### Docker Compose

| Переменная в корневом `.env`  | Назначение                                                        |
| ----------------------------- | ----------------------------------------------------------------- |
| `POSTGRES_DB`                 | Имя базы данных                                                   |
| `POSTGRES_USER`               | Пользователь PostgreSQL                                           |
| `POSTGRES_PASSWORD`           | Пароль PostgreSQL                                                 |
| `POSTGRES_PORT`               | Опубликованный порт PostgreSQL; в текущем Compose оставьте `5432` |
| `JWT_SECRET`                  | Секрет access token                                               |
| `JWT_REFRESH_SECRET`          | Секрет refresh token                                              |
| `JWT_ACCESS_TTL`              | Срок access token                                                 |
| `JWT_REFRESH_TTL`             | Срок refresh token                                                |
| `PARSER_TOKEN`                | Отдельный секрет доступа к парсеру                                |
| `PARSER_FILE_TIMEOUT_SECONDS` | Таймаут обработки одного файла                                    |
| `PARSER_CPU_THREADS`          | Число CPU-потоков PaddleOCR                                       |
| `FRONTEND_URL`                | Публичный origin для deployment override                          |
| `TRUST_PROXY_HOPS`            | Число доверенных proxy-hop для deployment override                |

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

Полный `docker compose up -d --build` запускает API, оба worker-процесса,
PostgreSQL, RabbitMQ, Redis, ClamAV, изолированный валидатор PDF/DOCX/XML и parser.
До первого запуска parser нужно заполнить volume моделей командой из раздела
«Быстрый запуск». Начальная загрузка сигнатур ClamAV может занять несколько минут;
`docker compose logs clamav` показывает готовность. До готовности сканера документы
отклоняются с понятной причиной.

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

Полная последовательность локального запуска, включая bind mount-каталоги,
Redis, parser proxy и оба worker-процесса, приведена в разделе
«Локальная разработка». `compose.dev.yaml` открывает служебные порты только на
localhost; не используйте его для production.

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

### Compose требует секреты

Для dev запускайте инфраструктуру с `--env-file backend/.env` и убедитесь, что
`JWT_SECRET`, `JWT_REFRESH_SECRET` и `PARSER_TOKEN` заполнены разными значениями
длиной не менее 32 символов. Для production заполните корневой `.env`.

### Docker отвечает `permission denied` для `/var/run/docker.sock`

Текущий пользователь не имеет доступа к Docker daemon. Используйте `sudo` для
всей последовательности Docker-команд либо один раз настройте доступ пользователя
к Docker согласно документации вашей ОС. Скрипт `backend test:services` сам
вызывает `docker`, поэтому для него требуется доступ без интерактивного `sudo`.

### Parser не становится `healthy`

Убедитесь, что OCR-модели были загружены до `up`:

```bash
docker compose --env-file .env --profile tools run --rm --build parser-models
docker compose --env-file .env logs --tail=200 parser parsing-worker
```

При локальной разработке используйте в этих командах оба файла:
`-f compose.yaml -f compose.dev.yaml`.

### API работает, но документы не обрабатываются

`bun run dev` не запускает фоновые процессы. В локальном режиме отдельно запустите
`bun run --cwd backend worker` и `bun run --cwd backend parsing:worker`, затем
проверьте Redis, RabbitMQ, ClamAV, validator и parser командой `docker compose ps`.

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

В Docker-режиме публикуются `5432`, `5672`, `15672` и `8080`. В dev-режиме также
используются `5173`, `3000`, `6379`, `3310`, `8081` и `8090`. Остановите
конфликтующий процесс или контейнер перед запуском выбранного режима.

### Авторизация не работает после внешнего деплоя

Проверьте HTTPS, точное совпадение публичного origin с `FRONTEND_URL` и передачу
cookie через reverse proxy. Для диагностики используйте логи frontend и backend,
а также вкладки Network и Application браузера.
