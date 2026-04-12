# HubPro

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Electron](https://img.shields.io/badge/Electron-31.0.0-47848F?style=flat-square&logo=electron)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=flat-square&logo=sqlite)

> **Профессиональный центр управления Telegram ботами**

## 🧠 О системе

**HubPro** — это desktop-приложение для централизованного управления Telegram ботами, группами и сообщениями.

**Разработано с помощью:** [NEURAL_ARCHITECT_PREMIUM++ v8.3 ULTIMATE](https://vk.com/smolyaninovchef)

**Автор:** Alex Smolyaninov [@ASV_prod](https://t.me/ASV_prod)

---

## ✨ Возможности

### 🤖 Управление ботами
- Добавление, редактирование и удаление Telegram ботов
- Активация/деактивация ботов одним кликом
- Валидация токенов через Telegram API

### 👥 Управление группами
- Привязка групп к ботам по Chat ID
- Поддержка тем (topics) в форумах
- Тегирование и поиск

### 💬 Отправка сообщений
- Отправка в одну или несколько групп
- Поддержка HTML и Markdown форматирования
- Планирование сообщений (scheduling)
- Предпросмотр перед отправкой

### 📊 Статистика и отчёты
- Дашборд с ключевыми метриками
- Экспорт в Excel (XLSX)
- Экспорт в PDF

### 🔔 Дополнительно
- Системный трей (сворачивание в фон)
- Автообновления через GitHub Releases
- Логирование всех действий
- Тестирование подключения

---

## 🛠 Технологии

| Компонент | Технология |
|-----------|------------|
| Платформа | Electron 31 |
| База данных | SQLite (better-sqlite3) |
| UI | Tailwind CSS + Glassmorphism |
| Сборка | electron-builder |
| Обновления | electron-updater |

---

## 📦 Установка

### Быстрый старт

```bash
# Клонирование репозитория
git clone https://github.com/smol0901-jpg/HubPro.git
cd HubPro

# Установка зависимостей
npm install

# Запуск в режиме разработки
npm start
```

### Сборка приложения

```bash
# Установка зависимостей (если ещё не установлены)
npm install

# Сборка .exe для Windows
npm run build
```

После сборки исполняемый файл будет находиться в папке `dist/`.

### Публикация обновлений

```bash
# Установите GitHub Personal Access Token
export GH_TOKEN=ghp_ВАШ_ТОКЕН

# Опубликовать релиз
npm run publish
```

---

## 🎨 Дизайн

Приложение использует современный **glassmorphism** стиль:

- Тёмная цветовая схема (#0a0e1a)
- Стеклянные карточки с blur-эффектом
- Градиентные кнопки (синий → фиолетовый)
- Glow-эффекты для атмосферы
- Плавные анимации и transitions

---

## 📁 Структура проекта

```
HubPro/
├── main.js              # Основной процесс Electron
├── preload.js           # Мост между renderer и main
├── renderer/
│   └── index.html       # Интерфейс приложения
├── package.json         # Конфигурация проекта
└── README.md            # Документация
```

---

## 🗄️ База данных

Приложение использует SQLite для хранения данных:

| Таблица | Описание |
|---------|----------|
| `bots` | Токены и настройки ботов |
| `groups` | Привязка групп к ботам |
| `messages` | История сообщений |
| `settings` | Настройки приложения |

База данных хранится в пользовательской папке приложения.

---

## 🔒 Безопасность

- Токены ботов хранятся локально в SQLite
- Context Isolation включён
- Node Integration отключён
- Preload-скрипт для безопасного IPC

---

## 📝 Автор

**Alex Smolyaninov**

- Telegram: [@ASV_prod](https://t.me/ASV_prod)
- VK: [vk.com/smolyaninovchef](https://vk.com/smolyaninovchef)

---

## 📄 Лицензия

MIT License

---

<div align="center">
  <p><strong>Разработано с помощью NEURAL_ARCHITECT_PREMIUM++ v8.3 ULTIMATE</strong></p>
  <p>© 2024-2026 Alex Smolyaninov</p>
</div>