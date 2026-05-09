// ===== Lock for All! - Lock Page Script =====

const params = new URLSearchParams(window.location.search);
const originalUrl = params.get("url") || "";
let unlockAt = parseInt(params.get("unlockAt")) || 0;
const domain = params.get("domain") || "";
let countdownInterval = null;
let redirected = false;

// Read authoritative unlockAt from chrome.storage.local
function refreshLockData() {
  return new Promise((resolve) => {
    chrome.storage.local.get("locks", (data) => {
      const locks = data.locks || [];
      const lock = locks.find(l => l.domain === domain);
      if (lock) {
        unlockAt = lock.unlockAt;
      }
      resolve(lock);
    });
  });
}

// Periodically sync unlockAt from storage
setInterval(() => {
  refreshLockData();
}, 2000);

// Set domain text
document.getElementById("domain-text").textContent = domain ? `Domain: ${domain}` : "";

// Load Pine Coin balance on lock page
function loadLockCoins() {
  chrome.runtime.sendMessage({ action: "getPineCoins" }, (response) => {
    if (response) {
      document.getElementById("lock-coin-count").textContent = response.pineCoins;
      const btn = document.getElementById("coin-unlock-btn");
      if (response.pineCoins < 5) {
        btn.disabled = true;
      } else {
        btn.disabled = false;
      }
    }
  });
}
loadLockCoins();
setInterval(loadLockCoins, 3000);

// Coin unlock button on lock page
document.getElementById("coin-unlock-btn").addEventListener("click", async () => {
  const btn = document.getElementById("coin-unlock-btn");
  btn.disabled = true;
  btn.textContent = "Đang mở...";
  const response = await chrome.runtime.sendMessage({ action: "coinUnlock", domain: domain });
  if (response && response.success) {
    // Lock removed, will redirect via updateCountdown
  } else {
    btn.disabled = false;
    btn.textContent = "🔑 Mở khóa (5 coin)";
    alert(response ? response.error : "Lỗi không xác định");
  }
});

// Background image
const bgOverlay = document.getElementById("bg-overlay");
const defaultBgUrl = chrome.runtime.getURL("background.png");
bgOverlay.style.backgroundImage = `url('${defaultBgUrl}')`;

// Load custom background if exists
chrome.storage.local.get("customBg", (data) => {
  if (data.customBg) {
    bgOverlay.style.backgroundImage = `url('${data.customBg}')`;
  }
});

// Background music
const bgMusic = document.getElementById("bg-music");
const defaultMusicUrl = chrome.runtime.getURL("background.mp3");
bgMusic.src = defaultMusicUrl;

// Load custom music if exists
chrome.storage.local.get("customMusic", (data) => {
  if (data.customMusic) {
    bgMusic.src = data.customMusic;
  }
});

// Try to autoplay music (may be blocked by browser policy)
document.addEventListener("click", () => {
  if (bgMusic.paused) bgMusic.play().catch(() => {});
}, { once: true });

// Also try on first interaction
document.addEventListener("mousemove", () => {
  if (bgMusic.paused) bgMusic.play().catch(() => {});
}, { once: true });

bgMusic.volume = 0.3;
bgMusic.play().catch(() => {});

// Upload music
document.getElementById("upload-music").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    chrome.storage.local.set({ customMusic: dataUrl });
    bgMusic.src = dataUrl;
    bgMusic.play().catch(() => {});
  };
  reader.readAsDataURL(file);
});

// Upload background
document.getElementById("upload-bg").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    chrome.storage.local.set({ customBg: dataUrl });
    bgOverlay.style.backgroundImage = `url('${dataUrl}')`;
  };
  reader.readAsDataURL(file);
});

// Countdown
async function updateCountdown() {
  if (redirected) return;

  // Sync from storage for accuracy
  const lock = await refreshLockData();

  // If lock no longer exists in storage, redirect immediately
  if (!lock) {
    redirected = true;
    if (countdownInterval) clearInterval(countdownInterval);
    if (originalUrl) {
      window.location.replace(originalUrl);
    }
    return;
  }

  const now = Date.now();
  const remaining = unlockAt - now;

  if (remaining <= 0) {
    redirected = true;
    if (countdownInterval) clearInterval(countdownInterval);
    if (originalUrl) {
      window.location.replace(originalUrl);
    }
    return;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  document.getElementById("cd-days").textContent = days;
  document.getElementById("cd-hours").textContent = String(hours).padStart(2, "0");
  document.getElementById("cd-minutes").textContent = String(minutes).padStart(2, "0");
  document.getElementById("cd-seconds").textContent = String(seconds).padStart(2, "0");
}

countdownInterval = setInterval(updateCountdown, 1000);
updateCountdown();

// Quotes rotation
let currentQuoteIndex = 0;

function showQuote() {
  if (typeof QUOTES === "undefined" || !QUOTES.length) return;
  const quote = QUOTES[currentQuoteIndex % QUOTES.length];
  document.getElementById("quote-text").textContent = `"${quote.text}"`;
  document.getElementById("quote-author").textContent = `— ${quote.author}`;
  currentQuoteIndex++;
}

showQuote();
setInterval(showQuote, 15000); // Change quote every 15 seconds

// Floating particles animation
function createParticles() {
  const count = 15;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div");
    particle.className = "particle";
    const size = Math.random() * 6 + 2;
    particle.style.width = size + "px";
    particle.style.height = size + "px";
    particle.style.left = Math.random() * 100 + "%";
    particle.style.animationDuration = (Math.random() * 15 + 10) + "s";
    particle.style.animationDelay = (Math.random() * 10) + "s";
    particle.style.opacity = Math.random() * 0.3 + 0.1;
    document.body.appendChild(particle);
  }
}
createParticles();
