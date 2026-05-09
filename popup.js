// ===== Lock for All! - Popup Script =====

let currentMode = "instant";
let captchaVerified = false;
let cooldownActive = false;

// Mode switching
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    document.querySelectorAll(".mode-section").forEach(s => s.classList.remove("active"));
    document.getElementById(`${currentMode}-section`).classList.add("active");
  });
});

// Custom math captcha
let captchaAnswer = 0;

function generateCaptcha() {
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;
  if (op === '+') {
    a = Math.floor(Math.random() * 50) + 10;
    b = Math.floor(Math.random() * 50) + 10;
    answer = a + b;
  } else if (op === '-') {
    a = Math.floor(Math.random() * 50) + 30;
    b = Math.floor(Math.random() * 30) + 1;
    answer = a - b;
  } else {
    a = Math.floor(Math.random() * 12) + 2;
    b = Math.floor(Math.random() * 12) + 2;
    answer = a * b;
  }
  captchaAnswer = answer;
  document.getElementById("captcha-challenge").textContent = `${a} ${op} ${b} = ?`;
  document.getElementById("captcha-input").value = "";
  document.getElementById("captcha-status").textContent = "";
  document.getElementById("captcha-status").style.color = "";
}

generateCaptcha();

document.getElementById("captcha-verify").addEventListener("click", () => {
  const input = parseInt(document.getElementById("captcha-input").value.trim());
  const statusEl = document.getElementById("captcha-status");
  if (input === captchaAnswer) {
    captchaVerified = true;
    statusEl.textContent = "✓ Xác nhận thành công!";
    statusEl.style.color = "#4caf50";
    document.getElementById("captcha-input").disabled = true;
    document.getElementById("captcha-verify").disabled = true;
    startCooldown();
  } else {
    statusEl.textContent = "✗ Sai! Thử lại.";
    statusEl.style.color = "#e94560";
    generateCaptcha();
  }
});

// Enter key for captcha input
document.getElementById("captcha-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("captcha-verify").click();
  }
});

function startCooldown() {
  cooldownActive = true;
  const btn = document.getElementById("lock-btn");
  const status = document.getElementById("lock-status");
  btn.disabled = true;
  btn.classList.add("cooldown");

  let remaining = 5;
  status.textContent = `Xác nhận thành công! Đợi ${remaining}s...`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      cooldownActive = false;
      btn.classList.remove("cooldown");
      btn.disabled = false;
      status.textContent = "Sẵn sàng khóa!";
    } else {
      status.textContent = `Xác nhận thành công! Đợi ${remaining}s...`;
    }
  }, 1000);
}

// Lock button
document.getElementById("lock-btn").addEventListener("click", () => {
  if (!captchaVerified || cooldownActive) return;
  doLock();
});

async function doLock() {
  const domainsText = document.getElementById("domains").value.trim();
  if (!domainsText) {
    showStatus("Vui lòng nhập ít nhất 1 domain!");
    return;
  }

  const domains = domainsText.split("\n").map(d => d.trim()).filter(d => d);
  if (domains.length === 0) {
    showStatus("Vui lòng nhập ít nhất 1 domain!");
    return;
  }

  let msg = {
    action: "lock",
    domains: domains,
    mode: currentMode
  };

  if (currentMode === "instant") {
    const duration = document.getElementById("instant-duration").value.trim();
    if (!duration) { showStatus("Vui lòng nhập thời gian khóa!"); return; }
    msg.duration = duration;
  } else if (currentMode === "timeout") {
    const allow = document.getElementById("timeout-allow").value.trim();
    const lock = document.getElementById("timeout-lock").value.trim();
    if (!allow || !lock) { showStatus("Vui lòng nhập đủ thời gian!"); return; }
    msg.timeoutDuration = allow;
    msg.duration = lock;
  } else if (currentMode === "calendar") {
    const date = document.getElementById("calendar-date").value;
    if (!date) { showStatus("Vui lòng chọn ngày giờ!"); return; }
    msg.calendarDate = date;
  }

  const btn = document.getElementById("lock-btn");
  btn.disabled = true;
  btn.textContent = "Đang khóa...";

  try {
    const response = await chrome.runtime.sendMessage(msg);
    if (response && response.success) {
      showStatus("✅ Khóa thành công!");
      // Reset captcha
      captchaVerified = false;
      document.getElementById("captcha-input").disabled = false;
      document.getElementById("captcha-verify").disabled = false;
      generateCaptcha();
      document.getElementById("lock-btn").disabled = true;
      document.getElementById("lock-btn").textContent = "Khóa!";
      loadActiveLocks();
    } else {
      showStatus("❌ Lỗi khi khóa!");
    }
  } catch (e) {
    showStatus("❌ Lỗi: " + e.message);
  }

  btn.textContent = "Khóa!";
}

function showStatus(text) {
  document.getElementById("lock-status").textContent = text;
}

// Load active locks
async function loadActiveLocks() {
  const response = await chrome.runtime.sendMessage({ action: "getLocks" });
  const container = document.getElementById("active-locks");
  if (!response || !response.locks || response.locks.length === 0) {
    container.innerHTML = '<div class="no-locks">Không có khóa nào</div>';
    return;
  }

  container.innerHTML = "";
  for (const lock of response.locks) {
    const item = document.createElement("div");
    item.className = "lock-item";

    const remaining = lock.unlockAt - Date.now();
    const remainingStr = formatDuration(remaining);

    item.innerHTML = `
      <div class="lock-item-info">
        <div class="lock-item-domain">${lock.domain}</div>
        <div class="lock-item-time">Còn lại: ${remainingStr}</div>
      </div>
      <div class="lock-item-buttons">
        <button class="coin-unlock-btn" data-domain="${lock.domain}" title="5 Pine Coin"><img class="coin-icon-sm" src="coin.svg" alt=""> 5</button>
        <button class="unlock-btn" data-id="${lock.id}">Mở khóa</button>
      </div>
    `;
    container.appendChild(item);
  }

  // Unlock buttons
  container.querySelectorAll(".unlock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ action: "unlock", lockId: btn.dataset.id });
      loadActiveLocks();
      loadPineCoins();
    });
  });

  // Coin unlock buttons
  container.querySelectorAll(".coin-unlock-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const domainName = btn.dataset.domain;
      const response = await chrome.runtime.sendMessage({ action: "coinUnlock", domain: domainName });
      if (response && response.success) {
        showStatus(`✅ Đã mở khóa ${domainName} bằng Pine Coin!`);
      } else {
        showStatus(`❌ ${response.error}`);
      }
      loadActiveLocks();
      loadPineCoins();
    });
  });
}

function formatDuration(ms) {
  if (ms <= 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}ngày`);
  if (h > 0) parts.push(`${h}giờ`);
  if (m > 0) parts.push(`${m}phút`);
  if (s > 0) parts.push(`${s}giây`);
  return parts.join(" ");
}

// Load Pine Coin balance
async function loadPineCoins() {
  const response = await chrome.runtime.sendMessage({ action: "getPineCoins" });
  if (response) {
    document.getElementById("pine-coin-count").textContent = response.pineCoins;
  }
}

// Init
loadActiveLocks();
loadPineCoins();

// Refresh locks and coins every 5 seconds
setInterval(loadActiveLocks, 5000);
setInterval(loadPineCoins, 5000);
