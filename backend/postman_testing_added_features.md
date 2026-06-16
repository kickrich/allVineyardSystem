# Как протестировать добавленный функционал (Postman + консоль)

Сервер должен быть запущен: `bin/rails s` (по умолчанию `http://localhost:3000`).

---

## 1. Телеметрия: ограничение «только in_progress/completed» (1.5)

### Postman

**Создать телеметрию для миссии в статусе `planned` — должна отклониться:**

1. Убедись, что есть миссия со статусом `planned` (не `in_progress` и не `completed`).
2. **POST** `http://localhost:3000/api/v1/telemetries`  
   **Body (raw, JSON):**
   ```json
   {
     "telemetry": {
       "mission_id": 1,
       "recorded_at": "2026-02-26T12:00:00Z",
       "latitude": 59.81,
       "longitude": 30.34,
       "altitude": 50,
       "battery": 80
     }
   }
   ```
   Подставь реальный `mission_id` миссии со статусом **planned**.

**Ожидаемо:** `422 Unprocessable Entity`, в теле что-то вроде:
```json
{
  "errors": ["Mission должна быть в статусе in_progress или completed для приёма телеметрии"]
}
```

**Успешный сценарий:** переведи миссию в `in_progress` (POST `/api/v1/missions/:id/start`), затем снова отправь тот же POST телеметрии — должен быть `201 Created`.

**История по миссии:**  
**GET** `http://localhost:3000/api/v1/telemetries?mission_id=1` — список телеметрии по миссии, отсортированный по `recorded_at`.

---

### Консоль (Rails)

```bash
bin/rails c
```

```ruby
mission = Mission.find(1)
mission.status
# => "planned"

t = Telemetry.new(mission: mission, recorded_at: Time.current, latitude: 59.81, longitude: 30.34)
t.valid?
# => false
t.errors.full_messages
# => ["Mission должна быть в статусе in_progress или completed для приёма телеметрии"]

mission.update!(status: "in_progress")
t.valid?
# => true
t.save!
# => true
```

---

## 2. MediaUpload: ограничение «только in_progress/completed» (1.6)

### Postman

**Создать медиа для миссии в статусе `planned` — должно отклониться:**

**POST** `http://localhost:3000/api/v1/media_uploads`  
**Body (raw, JSON):**
```json
{
  "media_upload": {
    "mission_id": 1,
    "media_type": "video",
    "url": "https://storage.example.com/mission1/video1.mp4"
  }
}
```
`mission_id` — миссия со статусом **planned**.

**Ожидаемо:** `422`, в теле ошибка про то, что миссия должна быть in_progress или completed.

**Успех:** переведи миссию в `in_progress`, повтори запрос — `201 Created`.

**Список медиа по миссии:**  
**GET** `http://localhost:3000/api/v1/media_uploads?mission_id=1`

---

### Консоль

```ruby
m = Mission.find(1)
m.update!(status: "planned")

mu = MediaUpload.new(mission: m, media_type: "video", url: "https://example.com/v.mp4")
mu.valid?
# => false
mu.errors.full_messages
# => ["Mission должна быть в статусе in_progress или completed для приёма медиа"]

m.update!(status: "in_progress")
mu.valid?
# => true
```

---

## 3. Глобальная обработка ошибок (1.8): 404 и 400

### Postman

**404 (несуществующий ресурс):**

- **GET** `http://localhost:3000/api/v1/drones/99999`  
- **GET** `http://localhost:3000/api/v1/missions/99999`  
- **GET** `http://localhost:3000/api/v1/telemetries/99999`

**Ожидаемо:** `404 Not Found`, тело например:
```json
{
  "errors": ["Record not found"]
}
```

**400 (нет обязательного параметра):**

- **POST** `http://localhost:3000/api/v1/telemetries`  
- **Body:** `{}` (пустой JSON) или без ключа `telemetry`.

**Ожидаемо:** `400 Bad Request`, в теле сообщение про отсутствующий параметр (например `param is missing or the value is empty: telemetry`).

---

### Консоль

Проверка только через HTTP (Postman/curl). В консоли можно убедиться, что `find` кидает:

```ruby
Drone.find(99999)
# => ActiveRecord::RecordNotFound
```

---

## 4. Валидации телеметрии (диапазоны)

### Postman

**POST** `http://localhost:3000/api/v1/telemetries` с невалидными значениями (миссия при этом in_progress):

```json
{
  "telemetry": {
    "mission_id": 1,
    "recorded_at": "2026-02-26T12:00:00Z",
    "latitude": 200,
    "longitude": 30,
    "altitude": -10,
    "battery": 150
  }
}
```

**Ожидаемо:** `422`, в `errors` сообщения о том, что latitude/altitude/battery вне допустимых диапазонов.

### Консоль

```ruby
m = Mission.find(1)
m.update!(status: "in_progress")

t = Telemetry.new(mission: m, recorded_at: Time.current, latitude: 200, longitude: 30, battery: 150)
t.valid?
# => false
t.errors.full_messages
# массив с ошибками по latitude, altitude, battery и т.д.
```

---

## 5. CORS (только из браузера)

Postman не проверяет CORS. Чтобы проверить:

1. Запусти React-фронт на другом порту (например 5173).
2. В коде фронта сделай запрос к `http://localhost:3000/api/v1/drones`.
3. В DevTools → Network посмотри ответ: заголовок `Access-Control-Allow-Origin` должен быть (в development — например `http://localhost:5173`).

Или в консоли браузера на странице фронта:

```javascript
fetch('http://localhost:3000/api/v1/drones').then(r => r.json()).then(console.log)
```

Если CORS настроен — запрос выполнится без ошибки «blocked by CORS».

---

## Краткая шпаргалка Postman

| Что проверить | Метод | URL | Ожидание |
|---------------|--------|-----|----------|
| Телеметрия для planned-миссии | POST | /api/v1/telemetries | 422, ошибка про статус миссии |
| Телеметрия по миссии | GET | /api/v1/telemetries?mission_id=1 | 200, массив по mission_id |
| Медиа для planned-миссии | POST | /api/v1/media_uploads | 422, ошибка про статус миссии |
| Медиа по миссии | GET | /api/v1/media_uploads?mission_id=1 | 200, массив |
| 404 | GET | /api/v1/drones/99999 | 404, `{"errors":["Record not found"]}` |
| 400 (нет telemetry) | POST | /api/v1/telemetries | Body: `{}` → 400 |

Все URL с префиксом: `http://localhost:3000`.
