/**
 * Безумный Куб — клиентская логика Telegram Mini App.
 * Зависимости: Telegram.WebApp (опционально), Web Audio API.
 */
(function () {
  "use strict";

  // =====================================================================
  // ИНИЦИАЛИЗАЦИЯ TELEGRAM
  // =====================================================================
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.expand();
    tg.setBackgroundColor("#0a0818");
    tg.setHeaderColor("#0a0818");
  }

  // =====================================================================
  // DOM-ЭЛЕМЕНТЫ (кешируем один раз)
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  const el = {
    cube: $("cube"),
    cubeWrapper: $("cubeWrapper"),
    taskDisplay: $("taskDisplay"),
    taskCard: $("taskCard"),
    shareBtn: $("shareBtn"),
    bombBtn: $("bombBtn"),
    scoreDisplay: $("score"),
    completedCount: $("completedCount"),
    bombCount: $("bombCount"),
    confettiContainer: $("confettiContainer"),
    bombModal: $("bombModal"),
    bombTaskDisplay: $("bombTaskDisplay"),
    timerDisplay: $("timerDisplay"),
    timerBarFill: $("timerBarFill"),
    doBombTaskBtn: $("doBombTaskBtn"),
    passBombBtn: $("passBombBtn"),
    loadingOverlay: $("loadingOverlay"),
  };

  // =====================================================================
  // СОСТОЯНИЕ
  // =====================================================================
  const state = {
    currentTask: null,
    isSpinning: false,
    score: 0,
    completedTasks: 0,
    bombPassedCount: 0,
    bombTimerId: null,
    bombTimerEnd: 0,
    bombData: null,
    isBombActive: false,
    hasGeneratedTask: false,
    currentBombId: null, // ID текущей бомбы при открытии
  };

  // =====================================================================
  // ВСПОМОГАТЕЛЬНЫЕ
  // =====================================================================
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // =====================================================================
  // ТОСТ-УВЕДОМЛЕНИЯ
  // =====================================================================
  function showToast(message, type) {
    const old = document.querySelector(".toast-notification");
    if (old) old.remove();

    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: ${type === "error" ? "#cc2244" : type === "success" ? "#22cc66" : "#6b2fcf"};
      color: white; padding: 10px 24px; border-radius: 40px;
      font-size: 0.9rem; font-weight: 600; z-index: 9999;
      box-shadow: 0 0 30px rgba(0,0,0,0.5);
      animation: toastIn 0.25s ease, toastOut 0.25s ease 2.8s forwards;
      max-width: 90vw; text-align: center; pointer-events: none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 3500);
  }

  // =====================================================================
  // КАСТОМНАЯ МОДАЛКА ПОДТВЕРЖДЕНИЯ (вместо confirm)
  // =====================================================================
  function showConfirmModal(title, message) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-box">
          <div class="confirm-title">${title}</div>
          <div class="confirm-message">${message.replace(/\n/g, "<br>")}</div>
          <div class="confirm-actions">
            <button class="btn confirm-cancel-btn">Отмена</button>
            <button class="btn confirm-ok-btn">💣 Передать!</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector(".confirm-cancel-btn").addEventListener("click", () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector(".confirm-ok-btn").addEventListener("click", () => {
        overlay.remove();
        resolve(true);
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  }

  // =====================================================================
  // ИНДИКАТОР ЗАГРУЗКИ
  // =====================================================================
  function showLoading(show) {
    if (el.loadingOverlay) {
      el.loadingOverlay.classList.toggle("active", show);
    }
  }

  // =====================================================================
  // Состояние кнопок
  // =====================================================================
  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn._origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-spinner"></span>`;
    } else {
      btn.disabled = false;
      if (btn._origHtml) btn.innerHTML = btn._origHtml;
    }
  }

  // =====================================================================
  // Копирование текста (fallback для Telegram)
  // =====================================================================
  async function copyToClipboard(text) {
    try {
      if (tg?.Clipboard) {
        tg.Clipboard.setText(text);
        return true;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback: textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }

  // =====================================================================
  // API-ВЫЗОВЫ (с обработкой ошибок)
  // =====================================================================
  async function apiFetch(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...options,
      });
      const data = await resp.json();
      if (!data.success) {
        throw new Error(data.error || "Unknown API error");
      }
      return data;
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("Сервер не отвечает. Попробуй ещё раз.");
      }
      if (err.name !== "Error" || !err.message.includes("API error")) {
        throw new Error("Нет соединения. Проверь интернет.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  const API = {
    getRandomTask() {
      return apiFetch("/api/tasks/random");
    },
    createBomb(task) {
      return apiFetch("/api/bomb/create", {
        method: "POST",
        body: JSON.stringify({ task }),
      });
    },
    checkBomb(bombId) {
      return apiFetch(`/api/bomb/check/${bombId}`);
    },
    completeBomb(bombId) {
      return apiFetch(`/api/bomb/complete/${bombId}`, { method: "POST" });
    },
    passBomb(bombId) {
      return apiFetch("/api/bomb/pass", {
        method: "POST",
        body: JSON.stringify({ bomb_id: bombId }),
      });
    },
  };

  // =====================================================================
  // ЗВУК (Web Audio) — корректное создание и resume
  // =====================================================================
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, type, duration, gainValue, startDelay) {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
      gain.gain.setValueAtTime(gainValue, ctx.currentTime + startDelay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
      osc.start(ctx.currentTime + startDelay);
      osc.stop(ctx.currentTime + startDelay + duration);
    } catch {
      /* тишина */
    }
  }

  function playCubeSound() {
    playTone(500 + Math.random() * 400, "sawtooth", 0.15, 0.12, 0);
    playTone(900 + Math.random() * 400, "square", 0.12, 0.08, 0.12);
    playTone(1300 + Math.random() * 300, "sine", 0.2, 0.06, 0.25);
  }

  function playBombSound() {
    playTone(300, "sawtooth", 0.3, 0.15, 0);
    playTone(200, "square", 0.4, 0.12, 0.15);
  }

  function playSuccessSound() {
    playTone(523, "sine", 0.15, 0.1, 0);
    playTone(659, "sine", 0.15, 0.1, 0.15);
    playTone(784, "sine", 0.2, 0.1, 0.3);
  }

  // =====================================================================
  // HAPTIC FEEDBACK
  // =====================================================================
  function triggerHaptic(style) {
    try {
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred(style);
      } else if (navigator.vibrate) {
        const d =
          style === "heavy" ? [50, 30, 50] : style === "light" ? 20 : 30;
        navigator.vibrate(d);
      }
    } catch {
      /* игнор */
    }
  }

  // =====================================================================
  // КОНФЕТТИ (защита от утечки, кастомные emoji)
  // =====================================================================
  const CONFETTI_COLORS = [
    "#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff",
    "#ff6bff", "#ff9f43", "#00d2d3", "#f368e0",
    "#ff9ff3", "#54a0ff", "#5f27cd", "#ff4757",
  ];
  const CONFETTI_SHAPES = ["✦", "●", "▲", "★", "♦", "♥", "⬡", "◆"];
  let confettiCount = 0;
  const MAX_CONFETTI = 200;

  function launchConfetti(count) {
    count = Math.min(count, 80);
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      if (confettiCount > MAX_CONFETTI) {
        const old = el.confettiContainer.querySelector(".confetti-piece");
        if (old) {
          old.remove();
          confettiCount--;
        }
      }

      const piece = document.createElement("div");
      piece.className = "confetti-piece";

      const color = CONFETTI_COLORS[(now + i) % CONFETTI_COLORS.length];
      const shape = CONFETTI_SHAPES[(now + i) % CONFETTI_SHAPES.length];
      const size = 8 + ((now + i * 7) % 14);

      piece.textContent = shape;
      piece.style.color = color;
      piece.style.fontSize = size + "px";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.top = "-10px";
      piece.style.animationDuration = 2 + Math.random() * 2.5 + "s";
      piece.style.animationDelay = Math.random() * 0.6 + "s";
      piece.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");

      el.confettiContainer.appendChild(piece);
      confettiCount++;

      piece.addEventListener("animationend", () => {
        piece.remove();
        confettiCount--;
      });
    }
  }

  // =====================================================================
  // СТАТИСТИКА (localStorage)
  // =====================================================================
  const STORAGE_KEY = "kub_stats_v3";

  function saveStats() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          score: state.score,
          completedTasks: state.completedTasks,
          bombPassedCount: state.bombPassedCount,
        })
      );
    } catch {
      /* игнор */
    }
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.score = data.score || 0;
        state.completedTasks = data.completedTasks || 0;
        state.bombPassedCount = data.bombPassedCount || 0;
      }
    } catch {
      /* игнор */
    }
  }

  function updateStats() {
    el.scoreDisplay.textContent = state.score;
    el.completedCount.textContent = state.completedTasks;
    el.bombCount.textContent = state.bombPassedCount;
    saveStats();
  }

  // Анимация счёта (число бежит вверх)
  function animateScore(from, to, el) {
    if (!el) return;
    const duration = 400;
    const start = performance.now();

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = Math.round(from + (to - from) * eased);
      el.textContent = current;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // =====================================================================
  // ЗАДАНИЕ
  // =====================================================================
  function setTask(text, isPlaceholder) {
    state.currentTask = text;
    state.hasGeneratedTask = !isPlaceholder;
    el.taskDisplay.textContent = text;
    el.taskDisplay.classList.toggle("task-placeholder", !!isPlaceholder);

    if (!isPlaceholder) {
      el.taskDisplay.classList.remove("task-pop");
      void el.taskDisplay.offsetWidth;
      el.taskDisplay.classList.add("task-pop");
    }
  }

  // =====================================================================
  // ВРАЩЕНИЕ КУБА
  // =====================================================================
  async function spinCube() {
    if (state.isSpinning) return;
    state.isSpinning = true;

    el.cube.classList.remove("spinning");
    void el.cube.offsetWidth;
    el.cube.classList.add("spinning");

    triggerHaptic("heavy");
    playCubeSound();

    await new Promise((resolve) => {
      const onEnd = () => {
        el.cube.removeEventListener("animationend", onEnd);
        resolve();
      };
      el.cube.addEventListener("animationend", onEnd, { once: true });
      setTimeout(resolve, 1200);
    });

    el.cube.classList.remove("spinning");
    state.isSpinning = false;

    try {
      showLoading(true);
      const data = await API.getRandomTask();
      setTask(data.task, false);
      triggerHaptic("medium");
      el.cubeWrapper.classList.add("haptic-flash");
      setTimeout(() => el.cubeWrapper.classList.remove("haptic-flash"), 200);
    } catch (err) {
      setTask("⚠️ " + err.message, false);
      showToast(err.message, "error");
    } finally {
      showLoading(false);
    }
  }

  // =====================================================================
  // СВАЙП ПО КУБУ
  // =====================================================================
  let touchStartX = 0;
  let touchStartY = 0;

  el.cubeWrapper.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
  }, { passive: true });

  el.cubeWrapper.addEventListener("touchend", (e) => {
    if (state.isBombActive) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 80) {
      // Свайп — более сильное вращение
      if (!state.isSpinning) spinCube();
    }
    // else: обычный клик обрабатывается отдельно
  }, { passive: true });

  // =====================================================================
  // ПОДЕЛИТЬСЯ
  // =====================================================================
  function getBotLink() {
    return "https://t.me/bezumnyy_kub_bot";
  }

  async function openShare(task, isBomb) {
    if (!task && !state.currentTask) return;
    const t = task || state.currentTask;
    const prefix = isBomb ? "💣" : "🔥";
    const text = `${prefix} Я ${isBomb ? "передал бомбу" : "выполнил задание"} от Безумного Куба: "${t}"! Тряси куб, если не струсил: ${getBotLink()}`;

    // Пробуем Telegram API
    const url = `https://t.me/share/url?url=${encodeURIComponent(text)}`;
    if (tg) {
      tg.openTelegramLink(url);
    } else {
      // Fallback: копируем в буфер
      const copied = await copyToClipboard(text);
      if (copied) {
        showToast("📋 Текст скопирован! Вставь в Telegram", "success");
      } else {
        window.open(url, "_blank");
      }
    }

    triggerHaptic("light");

    if (!isBomb) {
      const oldScore = state.score;
      state.completedTasks++;
      state.score += 10;
      animateScore(oldScore, state.score, el.scoreDisplay);
      updateStats();
      launchConfetti(60);
      playSuccessSound();
    }
  }

  // =====================================================================
  // БОМБА — СОЗДАНИЕ
  // =====================================================================
  async function createAndShareBomb(task) {
    if (!task && !state.currentTask) return;
    const t = task || state.currentTask;

    // Кастомное подтверждение вместо confirm() (не работает в Telegram)
    const ok = await showConfirmModal(
      "💣 Передать бомбу?",
      `Задание: "${t.length > 60 ? t.slice(0, 60) + "…" : t}"\nУ получателя будет 15 минут!`
    );
    if (!ok) return;

    try {
      setButtonLoading(el.bombBtn, true);
      showLoading(true);
      const result = await API.createBomb(t);
      await openShareBombLink(result);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      showLoading(false);
      setButtonLoading(el.bombBtn, false);
    }
  }

  async function openShareBombLink(result) {
    // Прямая ссылка на Mini App с bomb_id
    const miniAppUrl = result.link;

    // Копируем ссылку в буфер
    const copied = await copyToClipboard(miniAppUrl);

    if (copied) {
      showToast("📋 Ссылка скопирована! Отправь другу в личку", "success");
    } else if (tg) {
      // Fallback: открываем share dialog
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(miniAppUrl)}&text=${encodeURIComponent("💣 Я передаю тебе бомбу от Безумного Куба!")}`;
      tg.openTelegramLink(shareUrl);
    } else {
      window.open(miniAppUrl, "_blank");
    }

    triggerHaptic("heavy");
    const oldBomb = state.bombPassedCount;
    state.bombPassedCount++;
    animateScore(oldBomb, state.bombPassedCount, el.bombCount);
    updateStats();
    playBombSound();

    showToast(`💣 Бомба "${result.task}" передана!`, "success");
  }

  // =====================================================================
  // БОМБА — ТАЙМЕР (на основе Date.now, без дрифта)
  // =====================================================================
  function tickBombTimer() {
    const remaining = Math.max(0, state.bombTimerEnd - Date.now());
    const total = state.bombData?.totalTime || 900000;
    const progress = total > 0 ? (remaining / total) * 100 : 0;

    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    el.timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
    el.timerBarFill.style.width = `${clamp(progress, 0, 100)}%`;

    if (remaining < 60000) {
      el.timerBarFill.style.background = "#ff0000";
      el.timerDisplay.style.color = "#ff0000";
    } else if (remaining < 300000) {
      el.timerBarFill.style.background = "#ff6b00";
      el.timerDisplay.style.color = "#ff6b00";
    } else {
      el.timerBarFill.style.background = "linear-gradient(90deg, #ff6b6b, #ff4444)";
      el.timerDisplay.style.color = "#ff6b6b";
    }

    if (remaining <= 0) {
      clearInterval(state.bombTimerId);
      state.bombTimerId = null;
      bombExploded();
    }
  }

  function startBombTimer(timeLeftSec) {
    const totalMs = timeLeftSec * 1000;
    state.bombTimerEnd = Date.now() + totalMs;
    if (state.bombData) state.bombData.totalTime = totalMs;

    clearInterval(state.bombTimerId);
    tickBombTimer();
    state.bombTimerId = setInterval(tickBombTimer, 200);
  }

  function stopBombTimer() {
    clearInterval(state.bombTimerId);
    state.bombTimerId = null;
  }

  function showBombModal(task, timeLeftSec) {
    el.bombTaskDisplay.textContent = task;
    el.bombModal.classList.add("active");
    state.isBombActive = true;
    state.bombData = { task, totalTime: timeLeftSec * 1000 };

    startBombTimer(timeLeftSec);
    triggerHaptic("heavy");
    playBombSound();
  }

  function hideBombModal() {
    stopBombTimer();
    state.isBombActive = false;
    state.bombData = null;
    el.bombModal.classList.remove("active");
  }

  // =====================================================================
  // БОМБА — ВЗРЫВ
  // =====================================================================
  function bombExploded() {
    hideBombModal();

    const overlay = document.createElement("div");
    overlay.className = "explosion-overlay";
    overlay.innerHTML = `
      <div class="explosion-emoji">💥</div>
      <h1 class="explosion-title">БОМБА ВЗОРВАЛАСЬ!</h1>
      <p class="explosion-sub">Ты не выполнил задание вовремя!</p>
      <button class="explosion-btn">🔄 Попробовать снова</button>
    `;
    document.body.appendChild(overlay);

    triggerHaptic("heavy");

    // Позор
    const shameText = `💥 Я струсил и не выполнил задание: "${state.bombData?.task || "задание"}"! Тряси куб, если не струсил!`;
    setTimeout(() => {
      const url = `https://t.me/share/url?url=${encodeURIComponent(shameText)}`;
      if (tg) tg.openTelegramLink(url);
      else {
        copyToClipboard(shameText).then((ok) => {
          if (ok) showToast("📋 Текст позора скопирован!", "info");
          else window.open(url, "_blank");
        });
      }
    }, 1500);

    overlay.querySelector(".explosion-btn").addEventListener("click", () => {
      overlay.remove();
    });

    setTimeout(() => {
      if (overlay.parentNode) overlay.remove();
    }, 10000);
  }

  // =====================================================================
  // БОМБА — ПАРСИНГ URL
  // =====================================================================
  function getBombIdFromUrl() {
    // 1. Telegram WebApp: initDataUnsafe.start_param
    let sp = null;
    try {
      if (tg?.initDataUnsafe?.start_param) {
        sp = tg.initDataUnsafe.start_param;
      }
    } catch {}

    // 2. Fallback: URL query string
    if (!sp) {
      try {
        const params = new URLSearchParams(window.location.search);
        sp = params.get("startapp") || params.get("tgWebAppStartParam");
      } catch {}
    }

    if (!sp) return null;

    // Формат: bomb_<hex_id> (только bomb_id — никакого задания)
    if (sp.startsWith("bomb_")) {
      const bombId = sp.slice(5); // убираем "bomb_"
      // ID должен быть чистым hex (24 символа)
      if (bombId.length === 24 && /^[0-9a-f]+$/.test(bombId)) {
        return bombId;
      }
    }
    return null;
  }

  function checkForBombOnLoad() {
    const bombId = getBombIdFromUrl();
    if (!bombId) return;

    state.currentBombId = bombId;

    API.checkBomb(bombId)
      .then((data) => {
        if (data.status === "active") {
          showBombModal(data.task, data.time_left);
        } else if (data.status === "expired") {
          showToast("💥 Эта бомба уже взорвалась!", "error");
        } else if (data.status === "completed") {
          showToast("✅ Это задание уже выполнено!", "success");
        } else {
          showToast("❌ Бомба не найдена", "error");
        }
      })
      .catch((err) => showToast(err.message, "error"));
  }

  // =====================================================================
  // Background частицы (эффект звездопада)
  // =====================================================================
  function initParticles() {
    const container = document.body;
    for (let i = 0; i < 25; i++) {
      const p = document.createElement("div");
      p.className = "bg-particle";
      p.style.cssText = `
        position: fixed;
        width: ${1 + Math.random() * 2}px;
        height: ${1 + Math.random() * 2}px;
        background: rgba(${150 + Math.random() * 105}, ${50 + Math.random() * 100}, 255, ${0.2 + Math.random() * 0.3});
        border-radius: 50%;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        pointer-events: none;
        z-index: 0;
        animation: particleFloat ${5 + Math.random() * 8}s ease-in-out infinite;
        animation-delay: ${Math.random() * 5}s;
      `;
      document.body.appendChild(p);
    }
  }

  // =====================================================================
  // ОБРАБОТЧИКИ СОБЫТИЙ
  // =====================================================================

  // Клик по кубу
  el.cubeWrapper.addEventListener("click", (e) => {
    if (!state.isBombActive && !state.isSpinning) spinCube();
  });

  // Тряска (акселерометр)
  if (window.DeviceMotionEvent) {
    let lastShake = 0;
    window.addEventListener(
      "devicemotion",
      (event) => {
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;
        const mag = Math.sqrt(
          acc.x * acc.x + acc.y * acc.y + acc.z * acc.z
        );
        const now = Date.now();
        if (mag > 18 && now - lastShake > 600) {
          lastShake = now;
          if (!state.isSpinning && !state.isBombActive) {
            spinCube();
            triggerHaptic("heavy");
          }
        }
      },
      { passive: true }
    );
  }

  // Кнопка "Поделиться"
  el.shareBtn.addEventListener("click", async () => {
    if (!state.currentTask || !state.hasGeneratedTask) {
      await spinCube();
      if (state.currentTask) openShare();
      return;
    }
    openShare();
  });

  // Кнопка "Бомба"
  el.bombBtn.addEventListener("click", async () => {
    if (!state.currentTask || !state.hasGeneratedTask) {
      await spinCube();
      if (state.currentTask) await createAndShareBomb();
      return;
    }
    await createAndShareBomb();
  });

  // Модалка бомбы: выполнить
  el.doBombTaskBtn.addEventListener("click", async () => {
    if (!state.bombData) return;

    const bombId = state.currentBombId;
    hideBombModal();

    if (bombId) {
      try {
        setButtonLoading(el.doBombTaskBtn, true);
        showLoading(true);
        await API.completeBomb(bombId);
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        showLoading(false);
        setButtonLoading(el.doBombTaskBtn, false);
      }
    }

    setTask(`✅ Выполнено! "${state.bombData.task}"`);
    const oldScore = state.score;
    state.score += 15;
    state.completedTasks++;
    animateScore(oldScore, state.score, el.scoreDisplay);
    updateStats();
    triggerHaptic("heavy");
    launchConfetti(80);
    playSuccessSound();
  });

  // Модалка бомбы: передать
  el.passBombBtn.addEventListener("click", async () => {
    if (!state.bombData) return;

    const bombId = state.currentBombId;
    hideBombModal();

    if (bombId) {
      try {
        setButtonLoading(el.passBombBtn, true);
        showLoading(true);
        const result = await API.passBomb(bombId);
        await openShareBombLink(result);
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        showLoading(false);
        setButtonLoading(el.passBombBtn, false);
      }
    }
  });

  // =====================================================================
  // ИНИЦИАЛИЗАЦИЯ
  // =====================================================================
  function init() {
    loadStats();
    updateStats();

    setTask("👆 Тряси или жми на куб!", true);

    // Фоновые частицы
    initParticles();

    // Бомба
    checkForBombOnLoad();

    setTimeout(() => triggerHaptic("light"), 600);

    console.log("🚀 Безумный Куб v2.1 готов! Тряси или жми!");
  }

  // Ждём DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
