# 🗺️ Architecture Blueprint: GeoGuessr Enterprise (School Edition)

Версия: 1.0  
Тип развертывания: Self-Hosted / Hybrid Edge Cluster  
Масштабируемость: Поддержка неограниченного числа кастомных 2D-карт и комнат до 40+ игроков.

---

## 1. Аппаратное распределение (Hardware Topology)

Система использует асимметричный кластер для оптимизации слабых ARM-узлов и мощного x86 сервера.

| Узел (Hardware) | Роль в системе | Размещенные сервисы (Docker) | ОС / Архитектура |
| :--- | :--- | :--- | :--- |
| Main PC | Control Plane & Data | PostgreSQL, Minio S3, Valkey (Redis), RabbitMQ, Python AI/Workers, Nginx, cloudflared, LiveKit | Linux (Ubuntu/Debian) linux/amd64 |
| Zynq Nodes (x5) | Stateless Compute | Игровой движок (Go API), WebSocket обработчики | OpenWrt / Linux linux/arm/v7 |
| Edge | CDN & Security | Cloudflare Pages (Frontend), Cloudflare WAF, CDN | Глобальная сеть |

---

## 2. Сетевой слой и Безопасность (Network & Security)

* Скрытие IP (Zero Trust): На Main PC работает демон cloudflared. Он устанавливает исходящий туннель до серверов Cloudflare. Входящие порты на роутере закрыты (NAT не нужен).
* Авторизация: JWT токены. Выдаются Auth Service (Go). Хранятся в браузере в HttpOnly Secure куках (защита от XSS).
* Rate Limiting: Nginx + Valkey ограничивают количество запросов от одного IP/User_ID (защита от DDoS и брутфорса).
* Маршрутизация (Nginx): - Балансирует нагрузку /api/ между пятью IP-адресами Zynq (Round-Robin).
  - Отдает медиа напрямую из Minio, минуя Zynq.

---

## 3. Стек технологий (Tech Stack)

### Фронтенд (Cloudflare Pages)
* Ядро: React (Vite) + Tailwind CSS.
* Рендер панорам: Marzipano (идеально поддерживает тайлинг).
* Карта: Leaflet.js с использованием L.CRS.Simple (плоская система координат X/Y).
* Пре-модерация аватарок: nsfwjs (работает в браузере клиента для разгрузки сервера).

### Бэкенд (Zynq Nodes - ARM)
* Ядро: Go (Gin / Echo). Компилируется в единый бинарный файл без внешних зависимостей.
* Задачи: REST API, авторизация, валидация координат, поддержка WebSocket (Gorilla WebSocket) для мультиплеера.
* Стейт: Полностью Stateless. Вся информация о сессиях хранится в Valkey на Main PC.

### Воркеры и Админка (Main PC - x86)
* Ядро: Python (FastAPI + Celery).
* Тайлинг: Использование libvips для нарезки 8K панорам на тайлы 256x256 пикселей (DeepZoom).
* AI Модерация (NSFW): TensorFlow/PyTorch детектор изображений (проверяет панорамы перед публикацией).
* Фоновые задачи: Пересчет глобального ELO-рейтинга игроков (слушает RabbitMQ).

---

## 4. Ключевые технические решения

### 🎯 4.1. Механика подсчета очков
Используется экспоненциальное затухание баллов на основе Евклидова расстояния на плоской 2D-карте.

$Score = S_{max} \cdot e^{-\left(\frac{d}{K}\right)}$

* $S_{max}$: 5000 баллов (максимум).
* $d$: Расстояние в пикселях между загаданной точкой и догадкой.
* $K$: Коэффициент строгости.
* *Штраф за этаж:* Обязательная проверка floor_id. При несовпадении множитель очков = 0.

### 🖼️ 4.2. Обработка и отдача панорам
* Исходная эквиректангюлярная проекция загружается в админку.
* Python-воркер режет её на пирамиду тайлов.
* Все файлы складываются в Minio S3 с относительными путями: /maps/{map_id}/panoramas/{pano_id}/level/x_y.webp.
* Фронтенд скачивает только те квадраты, на которые сейчас смотрит игрок.

### 🎮 4.3. Мультиплеер (До 40+ игроков)

* Синхронизация состояния: Zynq Go-сервер через WebSockets рассылает обновления. Состояние комнаты дублируется в Valkey.
* Голосовой чат: Развертывание LiveKit Server на Main PC. Работает как SFU (Selective Forwarding Unit), минимизируя нагрузку на сеть клиентов. Go-бэкенд только генерирует токены доступа.

### 🛠️ 4.4. Архитектура БД (PostgreSQL)
* Users: ID, имя, хэш пароля, глобальный ELO.
* Maps: ID, название, границы X/Y, тип координат (позволяет добавлять новые школы и города).
* Floors: ID, Map_ID, URL плана (картинки).
* Panoramas: ID, Floor_ID, координаты X, Y, North_Offset (угол поворота севера).
* Matches / Guesses: История игр для аналитики.

---

## 5. CI/CD и Деплой (Deployment Flow)

Принцип: "Build once, run everywhere".

1.  Сборка: Использование docker buildx в GitHub Actions для создания multi-arch образов (linux/amd64 для PC, linux/arm/v7 для Zynq).
2.  Реестр: Образы пушатся в Docker Hub (или локальный registry).
3.  Фронтенд: Автоматический деплой React-приложения в Cloudflare Pages при пуше в ветку main.
4.  Запуск (Production): * На Main PC: docker-compose up -d (поднимает БД, воркеры, Nginx).
    * На Zynq: запуск легковесных Go-контейнеров (или голых бинарников, если OpenWrt не тянет Docker), указывающих на IP Main PC.
