# Список запросов API для Postman

Базовый URL: **`http://localhost:3000`** (или твой хост). Все эндпоинты под префиксом `/api/v1/`.

---

## Служебные

| Метод | URL | Body | Описание |
|-------|-----|------|----------|
| GET | `/up` | — | Проверка работы приложения (health check) |
| GET | `/api-docs` | — | Swagger UI (документация API) |

---

## Дроны (Drones)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/drones` | Query: `?status=idle` (опционально) | Список дронов, фильтр по статусу |
| GET | `/api/v1/drones/:id` | — | Один дрон по ID |
| POST | `/api/v1/drones` | Body см. ниже | Создать дрон |
| PUT / PATCH | `/api/v1/drones/:id` | Body см. ниже | Обновить дрон |
| DELETE | `/api/v1/drones/:id` | — | Удалить дрон (только если статус `offline`) |

**Body для POST/PUT дрона (JSON):**
```json
{
  "drone": {
    "name": "Дрон-1",
    "model": "DJI Mavic",
    "status": "idle",
    "battery": 100
  }
}
```
`status`: `idle` \| `in_mission` \| `charging` \| `offline`. Поля можно передавать частично при PATCH.

---

## Миссии (Missions)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/missions` | Query: `?status=planned`, `?drone_id=1`, `?zone_id=1`, `?active=1` | Список миссий; `active=1` — только planned/approved/in_progress |
| GET | `/api/v1/missions/:id` | — | Одна миссия с маршрутами (routes) |
| POST | `/api/v1/missions` | Body см. ниже | Создать миссию (статус ставится `planned`) |
| PUT / PATCH | `/api/v1/missions/:id` | Body см. ниже | Обновить миссию |
| DELETE | `/api/v1/missions/:id` | — | Удалить миссию |
| POST | `/api/v1/missions/:id/start` | — | Запустить миссию (planned → in_progress) |
| POST | `/api/v1/missions/:id/complete` | — | Завершить миссию (in_progress → completed) |

**Body для POST/PUT миссии (JSON):**
```json
{
  "mission": {
    "user_id": 1,
    "drone_id": 1,
    "zone_id": 1,
    "mission_type": "mapping",
    "status": "approved"
  }
}
```
`zone_id` опционален. `status` при создании игнорируется (всегда `planned`). `mission_type`: только `mapping`, `survey` или `inspection` (опционально).

---

## Маршруты (Routes)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/routes` | Query: `?mission_id=1` (опционально) | Список точек маршрута, по миссии или все |
| GET | `/api/v1/routes/:id` | — | Одна точка маршрута |
| POST | `/api/v1/routes` | Body см. ниже | Добавить точку маршрута к миссии |

**Body для POST маршрута (JSON):**
```json
{
  "route": {
    "mission_id": 1,
    "latitude": 59.75,
    "longitude": 30.25,
    "altitude": 50,
    "speed": 10,
    "sequence_number": 1,
    "max_altitude": 120
  }
}
```
`max_altitude` опционален (по умолчанию 150 м). Обязательны `latitude`, `longitude`; `altitude` — от 2 до max_altitude м; точка должна быть внутри полигона виноградника. Добавлять точки можно только к миссиям в статусе **planned** или **approved**.

---

## Телеметрия (Telemetries)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/telemetries` | Query: `?mission_id=1`, `?from=`, `?to=` (ISO8601) | Список телеметрии; фильтр по миссии и/или по времени recorded_at |
| GET | `/api/v1/telemetries/:id` | — | Одна запись телеметрии |
| POST | `/api/v1/telemetries` | Body см. ниже | Создать запись (миссия должна быть in_progress или completed) |
| PUT / PATCH | `/api/v1/telemetries/:id` | Body см. ниже | Обновить запись |
| DELETE | `/api/v1/telemetries/:id` | — | Удалить запись |

**Body для POST/PUT телеметрии (JSON):**
```json
{
  "telemetry": {
    "mission_id": 1,
    "recorded_at": "2026-02-26T12:00:00Z",
    "latitude": 59.81,
    "longitude": 30.34,
    "altitude": 75,
    "speed": 12.5,
    "battery": 68
  }
}
```
`recorded_at` обязательно (если не передан — подставится текущее время). Не может быть в будущем. Ограничения: latitude -90..90, longitude -180..180, altitude 0..1000 м, battery 0..100%. Миссия должна быть in_progress или completed.

---

## Медиа (Media uploads)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/media_uploads` | Query: `?mission_id=1`, `?media_type=video` | Список медиа; фильтр по миссии и/или типу |
| GET | `/api/v1/media_uploads/:id` | — | Одна запись медиа |
| POST | `/api/v1/media_uploads` | Body см. ниже | Создать (миссия in_progress или completed) |
| PUT / PATCH | `/api/v1/media_uploads/:id` | Body см. ниже | Обновить |
| DELETE | `/api/v1/media_uploads/:id` | — | Удалить |

**Body для POST/PUT медиа (JSON):**
```json
{
  "media_upload": {
    "mission_id": 1,
    "media_type": "video",
    "url": "https://storage.example.com/mission1/video.mp4"
  }
}
```
`media_type`: только `image` или `video`. URL обязателен, до 500 символов, должен начинаться с `http://` или `https://`. Миссия — in_progress или completed.

---

## Пользователи (Users)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/users` | — | Список пользователей по имени (без password_digest) |
| GET | `/api/v1/users/:id` | — | Один пользователь |
| POST | `/api/v1/users` | Body см. ниже | Создать пользователя |
| PUT / PATCH | `/api/v1/users/:id` | Body см. ниже | Обновить пользователя |
| DELETE | `/api/v1/users/:id` | — | Удалить пользователя |

**Body для POST/PUT пользователя (JSON):**
```json
{
  "user": {
    "name": "Иван",
    "email": "ivan@example.com",
    "password": "secret",
    "password_confirmation": "secret"
  }
}
```
Валидации: name 2–100 символов, email обязателен, уникален, формат email; при удалении — нельзя удалить пользователя с активной миссией (in_progress). Пароль пока не хешируется (нет bcrypt).

---

## Зоны (Zones)

| Метод | URL | Параметры / Body | Описание |
|-------|-----|------------------|----------|
| GET | `/api/v1/zones` | — | Список зон по имени |
| GET | `/api/v1/zones/:id` | — | Одна зона |
| POST | `/api/v1/zones` | Body см. ниже | Создать зону |
| PUT / PATCH | `/api/v1/zones/:id` | Body см. ниже | Обновить зону |
| DELETE | `/api/v1/zones/:id` | — | Удалить зону |

**Body для POST/PUT зоны (JSON):**
```json
{
  "zone": {
    "name": "Южный склон",
    "description": "Участок А",
    "boundary": [[30.25, 59.75], [30.26, 59.75], [30.26, 59.76], [30.25, 59.76]]
  }
}
```
`name` обязателен, 2–100 символов. `description` до 1000 символов. `boundary` — массив точек `[[lng, lat], ...]` (каждая точка — два числа) или пустой массив.

---

## Итого: быстрая шпаргалка по URL

```
GET    /up
GET    /api-docs

GET    /api/v1/drones
GET    /api/v1/drones/:id
POST   /api/v1/drones
PUT    /api/v1/drones/:id
DELETE /api/v1/drones/:id

GET    /api/v1/missions
GET    /api/v1/missions/:id
POST   /api/v1/missions
PUT    /api/v1/missions/:id
DELETE /api/v1/missions/:id
POST   /api/v1/missions/:id/start
POST   /api/v1/missions/:id/complete

GET    /api/v1/routes
GET    /api/v1/routes/:id
POST   /api/v1/routes

GET    /api/v1/telemetries
GET    /api/v1/telemetries/:id
POST   /api/v1/telemetries
PUT    /api/v1/telemetries/:id
DELETE /api/v1/telemetries/:id

GET    /api/v1/media_uploads
GET    /api/v1/media_uploads/:id
POST   /api/v1/media_uploads
PUT    /api/v1/media_uploads/:id
DELETE /api/v1/media_uploads/:id

GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PUT    /api/v1/users/:id
DELETE /api/v1/users/:id

GET    /api/v1/zones
GET    /api/v1/zones/:id
POST   /api/v1/zones
PUT    /api/v1/zones/:id
DELETE /api/v1/zones/:id
```

В Postman для запросов с телом выбери **Body → raw → JSON** и вставь соответствующий JSON из таблиц выше.
