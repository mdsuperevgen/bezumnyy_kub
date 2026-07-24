"""Безумный Куб — Telegram Mini App для вечеринок."""
import os
import random
import json
import time
import base64
import secrets
from flask import Flask, render_template, jsonify, request

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------
SECRET_KEY = os.getenv("SECRET_KEY", os.urandom(24).hex())
BOT_USERNAME = os.getenv("BOT_USERNAME", "bezumnyy_kub_bot")
BOMB_TIMEOUT = int(os.getenv("BOMB_TIMEOUT", "900"))
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
TASKS_FILE = os.path.join(DATA_DIR, "tasks.json")

app = Flask(__name__)
app.secret_key = SECRET_KEY

# Trust Cloudflare/Proxy headers in production
app.config["PREFERRED_URL_SCHEME"] = os.getenv("URL_SCHEME", "https")

# ---------------------------------------------------------------------------
# Загрузка заданий
# ---------------------------------------------------------------------------
DEFAULT_TASKS = {
    "физические": [
        "Сделай 30 приседаний и крикни 'Я БЕЗУМНЫЙ'",
        "Отожмись 20 раз, считая вслух каждое отжимание",
        "Сделай 5 берпи и прокричи 'БОМБА'",
        "Постой на одной ноге 30 секунд с закрытыми глазами",
        "Планка 45 секунд — записывай на видео",
    ],
    "социальные": [
        "Отправь голосовое с пением гимна своей страны",
        "Напиши бывшему 'Я тебя люблю' и отправь скрин в чат",
        "Скажи комплимент каждому участнику чата",
        "Позвони маме и скажи 'Я тебя обожаю' (запись обязательно)",
        "Напиши стихотворение про куб и отправь в чат",
    ],
    "креативные": [
        "Нарисуй персонажа из мема и покажи камере",
        "Напиши рецепт бутерброда в стихах и отправь в чат",
        "Сочини рэп про Безумный Куб (4 строчки)",
        "Сделай оригами из любой бумаги и сфотографируй",
        "Напиши хокку про куб",
    ],
    "странные": [
        "Съешь ложку острого соуса и запиши реакцию",
        "Поменяй аватарку на куб на 1 час",
        "Сделай 10 шагов задом наперед и запиши",
        "Надень носки на руки и походи так 2 минуты",
        "Поговори сам с собой в зеркале 30 секунд",
    ],
    "интеллектуальные": [
        "Реши пример 137 × 239 в уме и напиши ответ",
        "Назови столицы 5 стран за 10 секунд",
        "Придумай рифму к слову 'куб' (минимум 3)",
        "Расскажи 3 интересных факта о космосе",
        "Назови 3 книги, которые должен прочитать каждый",
    ],
    "экстремальные": [
        "Облейся холодной водой с криком 'БЕЗУМНЫЙ КУБ'",
        "Станцуй тверк 30 секунд на камеру",
        "Спой песню с закрытым ртом (мычанием)",
        "Оближи локоть — попытка не пытка",
        "Съешь лук как яблоко (на видео)",
    ],
    "кулинарные": [
        "Смешай 3 любых напитка и выпей (получится коктейль)",
        "Съешь ложку мёда с горчицей",
        "Завари самый странный чай из того что есть",
        "Сделай бутерброд с неожиданным сочетанием и съешь",
        "Приготовь блюдо без рецепта на свой страх и риск",
    ],
    "музыкальные": [
        "Спой любую песню в жанре речитатив",
        "Придумай мелодию из 5 нот и напой в голосовом",
        "Станцуй под песню, которую никогда не слышал",
        "Исполни песню задом наперед",
        "Создай ритм используя только тело (битбокс)",
    ],
    "актерские": [
        "Сыграй сцену из фильма одним предметом реквизита",
        "Изобрази 3 разных животных за 10 секунд",
        "Прочитай любое объявление с интонацией Шекспира",
        "Придумай и покажи рекламу выдуманного товара",
        "Изобрази человека, который впервые видит снег",
    ],
    "ностальгические": [
        "Вспомни и опиши свою любимую игру из детства",
        "Назови 3 мультфильма, которые смотрел в детстве",
        "Найди старую фотографию и отправь в чат",
        "Напиши 3 слова, которые были популярны в твоей юности",
        "Вспомни запах из детства и опиши его",
    ],
}


def load_tasks():
    """Загружает задания из JSON. При ошибке создаёт набор по умолчанию."""
    try:
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(TASKS_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_TASKS, f, ensure_ascii=False, indent=2)
        return DEFAULT_TASKS


TASKS = load_tasks()
ALL_TASKS = [t for tasks in TASKS.values() for t in tasks]


# ---------------------------------------------------------------------------
# Управление бомбами
# ---------------------------------------------------------------------------
class BombManager:
    """Хранилище бомб в памяти. При перезапуске сервера бомбы сбрасываются."""

    def __init__(self):
        self.bombs: dict[str, dict] = {}

    def _generate_id(self, task: str) -> str:
        raw = f"{secrets.token_hex(4)}_{task[:10]}_{int(time.time())}"
        return base64.urlsafe_b64encode(raw.encode()).decode()[:14]

    def create_bomb(self, task: str, owner_id: str | None = None):
        bomb_id = self._generate_id(task)
        now = time.time()
        self.bombs[bomb_id] = {
            "task": task,
            "task_encoded": base64.urlsafe_b64encode(task.encode()).decode(),
            "created_at": now,
            "expires_at": now + BOMB_TIMEOUT,
            "owner_id": owner_id,
            "status": "active",
        }
        return bomb_id, self.bombs[bomb_id]

    def get_bomb(self, bomb_id: str) -> dict | None:
        return self.bombs.get(bomb_id)

    def complete_bomb(self, bomb_id: str) -> bool:
        bomb = self.bombs.get(bomb_id)
        if bomb and bomb["status"] == "active":
            bomb["status"] = "completed"
            return True
        return False

    def pass_bomb(self, bomb_id: str, new_owner_id: str | None = None):
        old = self.bombs.get(bomb_id)
        if not old or old["status"] != "active":
            return None
        old["status"] = "passed"
        return self.create_bomb(old["task"], new_owner_id)

    def check_expired(self, bomb_id: str) -> bool:
        """Возвращает True и меняет статус на expired, если время вышло."""
        bomb = self.bombs.get(bomb_id)
        if bomb and bomb["status"] == "active" and time.time() > bomb["expires_at"]:
            bomb["status"] = "expired"
            return True
        return False

    def stats(self):
        active = sum(1 for b in self.bombs.values() if b["status"] == "active")
        completed = sum(1 for b in self.bombs.values() if b["status"] == "completed")
        expired = sum(1 for b in self.bombs.values() if b["status"] == "expired")
        return {"active": active, "completed": completed, "expired": expired, "total": len(self.bombs)}


bomb_manager = BombManager()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _bomb_link(bomb_id: str, task_encoded: str) -> str:
    """Генерирует корректную Telegram Deep Link."""
    startapp = f"bomb_{bomb_id}_{task_encoded}"
    return f"https://t.me/{BOT_USERNAME}/app?startapp={startapp}", startapp


# ---------------------------------------------------------------------------
# Маршруты
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/tasks/random")
def random_task():
    """Возвращает случайное задание."""
    return jsonify({"success": True, "task": random.choice(ALL_TASKS)})


@app.route("/api/bomb/create", methods=["POST"])
def create_bomb():
    data = request.get_json(silent=True)
    if not data or "task" not in data:
        return jsonify({"success": False, "error": "Task is required"}), 400

    bomb_id, bomb_data = bomb_manager.create_bomb(data["task"], data.get("owner_id"))
    link, start_param = _bomb_link(bomb_id, bomb_data["task_encoded"])

    return jsonify({
        "success": True,
        "bomb_id": bomb_id,
        "start_param": start_param,
        "task": bomb_data["task"],
        "expires_at": bomb_data["expires_at"],
        "link": link,
    })


@app.route("/api/bomb/check/<bomb_id>")
def check_bomb(bomb_id):
    bomb = bomb_manager.get_bomb(bomb_id)
    if not bomb:
        return jsonify({"success": False, "error": "Bomb not found"}), 404

    # Проверяем истекла ли
    bomb_manager.check_expired(bomb_id)

    now = time.time()
    time_left = max(0, bomb["expires_at"] - now)

    return jsonify({
        "success": True,
        "status": bomb["status"],
        "task": bomb["task"],
        "time_left": int(time_left),
        "expires_at": bomb["expires_at"],
        "is_expired": bomb["status"] == "expired",
    })


@app.route("/api/bomb/complete/<bomb_id>", methods=["POST"])
def complete_bomb(bomb_id):
    if bomb_manager.complete_bomb(bomb_id):
        return jsonify({"success": True, "message": "Bomb completed!"})
    return jsonify({"success": False, "error": "Bomb not found or already completed"}), 404


@app.route("/api/bomb/pass", methods=["POST"])
def pass_bomb():
    data = request.get_json(silent=True)
    if not data or "bomb_id" not in data:
        return jsonify({"success": False, "error": "bomb_id required"}), 400

    result = bomb_manager.pass_bomb(data["bomb_id"])
    if not result:
        return jsonify({"success": False, "error": "Bomb not found or no longer active"}), 404

    new_id, new_data = result
    link, start_param = _bomb_link(new_id, new_data["task_encoded"])

    return jsonify({
        "success": True,
        "bomb_id": new_id,
        "start_param": start_param,
        "task": new_data["task"],
        "expires_at": new_data["expires_at"],
        "link": link,
    })


@app.route("/api/stats")
def get_stats():
    return jsonify({"success": True, **bomb_manager.stats()})


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("DEBUG", "true").lower() == "true"

    # Windows cp1251-safe вывод
    import sys
    stdout = sys.stdout
    print("=" * 50)
    print("  **  BEZUMNYJ KUB ZAPUSCHEN!  **")
    print("=" * 50)
    print(f"  Zadanij zagruzheno: {len(ALL_TASKS)}")
    host_display = host if host != "0.0.0.0" else "127.0.0.1"
    print(f"  Server: http://{host_display}:{port}")
    print(f"  Bot: @{BOT_USERNAME}")
    print("=" * 50)
    print(f"  Python: {sys.version}", file=stdout)

    app.run(debug=debug, host=host, port=port)
