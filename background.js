// ===== Lock for All! - Background Service Worker =====

const LOCK_PAGE_URL = chrome.runtime.getURL("lock.html");

// Parse duration string like "1y", "2mo", "3d", "4h", "5m", "6s"
function parseDuration(str) {
  const regex = /(\d+)(y|mo|d|h|m|s)/g;
  let ms = 0;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const val = parseInt(match[1]);
    switch (match[2]) {
      case "y":  ms += val * 365 * 24 * 60 * 60 * 1000; break;
      case "mo": ms += val * 30 * 24 * 60 * 60 * 1000; break;
      case "d":  ms += val * 24 * 60 * 60 * 1000; break;
      case "h":  ms += val * 60 * 60 * 1000; break;
      case "m":  ms += val * 60 * 1000; break;
      case "s":  ms += val * 1000; break;
    }
  }
  return ms;
}

// Extract domain from URL
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch { return null; }
}

// Check if a URL matches any locked domain
function isUrlLocked(url, locks) {
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) return null;
  const domain = extractDomain(url);
  if (!domain) return null;
  const now = Date.now();
  for (const lock of locks) {
    if (now < lock.unlockAt) {
      const lockDomain = lock.domain.replace(/^www\./, "");
      const urlDomain = domain.replace(/^www\./, "");
      if (urlDomain === lockDomain || urlDomain.endsWith("." + lockDomain)) {
        return lock;
      }
    }
  }
  return null;
}

// Redirect tab to lock page
function redirectTabToLock(tabId, originalUrl, lock) {
  const lockUrl = `${LOCK_PAGE_URL}?url=${encodeURIComponent(originalUrl)}&unlockAt=${lock.unlockAt}&domain=${encodeURIComponent(lock.domain)}`;
  chrome.tabs.update(tabId, { url: lockUrl });
}

// Navigate back to original URL after unlock
function redirectBack(tabId, originalUrl) {
  chrome.tabs.update(tabId, { url: originalUrl });
}

// Set alarm for lock expiry
function setUnlockAlarm(lockId, unlockAt) {
  const delay = Math.max(0.1, (unlockAt - Date.now()) / 1000);
  chrome.alarms.create(`unlock_${lockId}`, { delayInMinutes: delay / 60 });
}

// Clean expired locks and award Pine Coins
async function cleanExpiredLocks() {
  const data = await chrome.storage.local.get(["locks", "pineCoins"]);
  const locks = data.locks || [];
  let pineCoins = data.pineCoins || 0;
  const now = Date.now();
  const active = locks.filter(l => now < l.unlockAt);
  const expired = locks.filter(l => now >= l.unlockAt && !l.coinAwarded);

  // Award Pine Coins: 1 coin per minute of lock duration
  for (const lock of expired) {
    const lockDurationMs = lock.unlockAt - lock.lockedAt;
    const lockDurationMin = Math.max(1, Math.round(lockDurationMs / (60 * 1000)));
    pineCoins += lockDurationMin;
    lock.coinAwarded = true;
  }

  // Also mark already-awarded expired locks for removal
  const toRemove = locks.filter(l => now >= l.unlockAt && l.coinAwarded);
  const finalActive = locks.filter(l => now < l.unlockAt);

  await chrome.storage.local.set({ locks: finalActive, pineCoins: pineCoins });
  return { active: finalActive, expired };
}

// Handle web navigation - redirect locked sites
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // Only main frame
  const data = await chrome.storage.local.get("locks");
  const locks = data.locks || [];
  const lock = isUrlLocked(details.url, locks);
  if (lock) {
    redirectTabToLock(details.tabId, details.url, lock);
  }
});

// Handle alarm - unlock expired locks
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("unlock_")) {
    await cleanExpiredLocks();
  }
});

// Listen for messages from popup and lock page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "lock") {
    handleLock(msg).then(sendResponse);
    return true;
  }
  if (msg.action === "getLocks") {
    chrome.storage.local.get("locks").then(data => {
      const now = Date.now();
      const active = (data.locks || []).filter(l => now < l.unlockAt);
      sendResponse({ locks: active });
    });
    return true;
  }
  if (msg.action === "unlock") {
    handleUnlock(msg.lockId).then(sendResponse);
    return true;
  }
  if (msg.action === "coinUnlock") {
    handleCoinUnlock(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.action === "getPineCoins") {
    chrome.storage.local.get("pineCoins", (data) => {
      sendResponse({ pineCoins: data.pineCoins || 0 });
    });
    return true;
  }
  if (msg.action === "checkUrl") {
    chrome.storage.local.get("locks").then(data => {
      const lock = isUrlLocked(msg.url, data.locks || []);
      sendResponse({ locked: !!lock, lock });
    });
    return true;
  }
  if (msg.action === "getOriginalUrl") {
    // Find tabs on lock page and get original URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ tabId: tabs[0].id });
      }
    });
    return true;
  }
});

async function handleLock(msg) {
  const { domains, mode, duration, calendarDate, timeoutDuration } = msg;
  const data = await chrome.storage.local.get("locks");
  const locks = data.locks || [];
  const now = Date.now();
  const newLocks = [];

  for (const domain of domains) {
    const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!cleanDomain) continue;

    let unlockAt;
    if (mode === "instant") {
      unlockAt = now + parseDuration(duration);
    } else if (mode === "timeout") {
      // timeout: allow usage for timeoutDuration, then lock for duration
      const allowUntil = now + parseDuration(timeoutDuration);
      const lockDuration = parseDuration(duration);
      unlockAt = allowUntil + lockDuration;
      // We store the timeout phase too
      newLocks.push({
        id: `lock_${Date.now()}_${cleanDomain}`,
        domain: cleanDomain,
        mode: "timeout",
        allowUntil: allowUntil,
        unlockAt: allowUntil + lockDuration,
        lockedAt: now,
        originalUrls: {}
      });
      continue;
    } else if (mode === "calendar") {
      unlockAt = new Date(calendarDate).getTime();
    }

    newLocks.push({
      id: `lock_${Date.now()}_${cleanDomain}`,
      domain: cleanDomain,
      mode: mode,
      unlockAt: unlockAt,
      lockedAt: now,
      originalUrls: {}
    });
  }

  const allLocks = [...locks, ...newLocks];
  await chrome.storage.local.set({ locks: allLocks });

  // Set alarms
  for (const lock of newLocks) {
    setUnlockAlarm(lock.id, lock.unlockAt);
    if (lock.mode === "timeout" && lock.allowUntil) {
      // Set alarm for when timeout ends and lock begins
      const delay = Math.max(0.1, (lock.allowUntil - Date.now()) / 1000);
      chrome.alarms.create(`timeout_${lock.id}`, { delayInMinutes: delay / 60 });
    }
  }

  // For instant and calendar mode, redirect current tabs immediately
  if (mode === "instant" || mode === "calendar") {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const lock = isUrlLocked(tab.url, newLocks);
      if (lock) {
        redirectTabToLock(tab.id, tab.url, lock);
      }
    }
  }

  return { success: true, locks: newLocks };
}

async function handleUnlock(lockId) {
  const data = await chrome.storage.local.get(["locks", "pineCoins"]);
  const locks = data.locks || [];
  const lock = locks.find(l => l.id === lockId);
  const updated = locks.filter(l => l.id !== lockId);
  await chrome.storage.local.set({ locks: updated });

  // Redirect any tabs that were on the lock page for this domain
  if (lock) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && tab.url.includes(LOCK_PAGE_URL)) {
        try {
          const url = new URL(tab.url);
          const originalUrl = url.searchParams.get("url");
          const domain = url.searchParams.get("domain");
          if (domain === lock.domain && originalUrl) {
            redirectBack(tab.id, originalUrl);
          }
        } catch {}
      }
    }
  }

  return { success: true };
}

// Unlock a domain using Pine Coins (5 coins per domain)
async function handleCoinUnlock(domainName) {
  const data = await chrome.storage.local.get(["locks", "pineCoins"]);
  let pineCoins = data.pineCoins || 0;
  const locks = data.locks || [];

  // Find all locks for this domain
  const domainLocks = locks.filter(l => l.domain === domainName && Date.now() < l.unlockAt);
  if (domainLocks.length === 0) {
    return { success: false, error: "Không tìm thấy khóa cho domain này" };
  }

  const cost = 5 * domainLocks.length;
  if (pineCoins < cost) {
    return { success: false, error: `Không đủ Pine Coin! Cần ${cost}, đang có ${pineCoins}` };
  }

  // Deduct coins and remove locks
  pineCoins -= cost;
  const updated = locks.filter(l => l.domain !== domainName || Date.now() >= l.unlockAt);
  await chrome.storage.local.set({ locks: updated, pineCoins: pineCoins });

  // Redirect tabs on lock page for this domain
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.includes(LOCK_PAGE_URL)) {
      try {
        const url = new URL(tab.url);
        const originalUrl = url.searchParams.get("url");
        const d = url.searchParams.get("domain");
        if (d === domainName && originalUrl) {
          redirectBack(tab.id, originalUrl);
        }
      } catch {}
    }
  }

  return { success: true, pineCoins: pineCoins };
}

// On install, restore alarms for existing locks
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get("locks");
  const locks = data.locks || [];
  const now = Date.now();
  for (const lock of locks) {
    if (now < lock.unlockAt) {
      setUnlockAlarm(lock.id, lock.unlockAt);
    }
    if (lock.mode === "timeout" && lock.allowUntil && now < lock.allowUntil) {
      const delay = Math.max(0.1, (lock.allowUntil - Date.now()) / 1000);
      chrome.alarms.create(`timeout_${lock.id}`, { delayInMinutes: delay / 60 });
    }
  }
});

// On startup, restore alarms
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get("locks");
  const locks = data.locks || [];
  const now = Date.now();
  for (const lock of locks) {
    if (now < lock.unlockAt) {
      setUnlockAlarm(lock.id, lock.unlockAt);
    }
    if (lock.mode === "timeout" && lock.allowUntil && now < lock.allowUntil) {
      const delay = Math.max(0.1, (lock.allowUntil - Date.now()) / 1000);
      chrome.alarms.create(`timeout_${lock.id}`, { delayInMinutes: delay / 60 });
    }
  }
});

// Handle timeout phase - when allow time ends, start locking
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("timeout_")) {
    const lockId = alarm.name.replace("timeout_", "");
    const data = await chrome.storage.local.get("locks");
    const locks = data.locks || [];
    const lock = locks.find(l => l.id === lockId);
    if (lock && lock.mode === "timeout") {
      // Now lock all tabs for this domain
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        const l = isUrlLocked(tab.url, [lock]);
        if (l) {
          redirectTabToLock(tab.id, tab.url, l);
        }
      }
    }
  }
});

// Periodically clean expired locks
chrome.alarms.create("cleanup", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "cleanup") {
    await cleanExpiredLocks();
  }
});
